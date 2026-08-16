"use client";

import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import { applySignedStockDeltas, listCatalogLocally, loadCatalogFromServer, saveCatalogLocally } from "@/lib/offline/catalog";
import { requestOwnerAuthorization } from "@/lib/offline/owner-authorize";
import { syncNow } from "@/lib/offline/sync-client";
import { useEffect, useMemo, useState } from "react";
import { formatMoneyCents } from "../sales/sales-screen";
import type { CatalogProduct } from "@fiao/contracts/sales";

export function InventoryScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<CatalogProduct | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const fresh = await loadCatalogFromServer(activeBranchId);
          if (cancelled) return;
          setProducts(fresh);
          await saveCatalogLocally(fresh).catch(() => undefined);
        } else {
          const local = await listCatalogLocally(activeBranchId);
          if (cancelled) return;
          if (local.length > 0) setProducts(local);
          else setLoadError("Sin conexión y sin catálogo guardado en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listCatalogLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setProducts(local);
        else setLoadError("No se pudo cargar el inventario.");
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((product) => product.name.toLowerCase().includes(needle));
  }, [products, query]);

  return (
    <div className="customers-screen">
      <div className="pos-search">
        <input
          type="search"
          placeholder="Buscar producto…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar producto"
        />
      </div>

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      <ul className="customer-list" aria-label="Inventario">
        {filtered.map((product) => (
          <li key={product.id} className="customer-item">
            <div className="customer-info">
              <strong>{product.name}</strong>
              <span>
                {product.stockControl && product.onHand !== null
                  ? `${product.onHand} ${product.unitLabel}`
                  : "Sin control de stock"}
                {" · "}
                {formatMoneyCents(product.priceCents)}
              </span>
            </div>
            {product.stockControl ? (
              <button type="button" className="customer-abono" onClick={() => setAdjustTarget(product)}>
                Ajustar
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {adjustTarget ? (
        <AdjustStockSheet
          product={adjustTarget}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          role={user.role}
          online={online}
          onCancel={() => setAdjustTarget(null)}
          onDone={(productId, quantityDelta) => {
            setProducts((current) =>
              current.map((product) => {
                if (product.id !== productId || product.onHand === null) return product;
                const delta = Number(quantityDelta);
                return { ...product, onHand: String(Math.max(0, Number(product.onHand) + delta)) };
              })
            );
            setAdjustTarget(null);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustStockSheet({
  product,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  role,
  online,
  onCancel,
  onDone
}: {
  product: CatalogProduct;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  role: "OWNER" | "CASHIER";
  online: boolean;
  onCancel: () => void;
  onDone: (productId: string, quantityDelta: string) => void;
}) {
  const [delta, setDelta] = useState("5");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deltaValid = /^[+-]?\d+(\.\d{1,3})?$/.test(delta) && Number(delta) !== 0;
  const valid = deltaValid && reason.trim().length > 0 && (role === "OWNER" || pin.length >= 4);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const operationId = crypto.randomUUID();
      let ownerAuthorizationId: string | null = null;
      if (role !== "OWNER") {
        if (!online) {
          setError("El ajuste requiere conexión para validar el PIN del dueño. Conéctate e inténtalo de nuevo.");
          return;
        }
        const authorization = await requestOwnerAuthorization({
          branchId,
          purpose: "STOCK_ADJUSTMENT",
          targetOperationId: operationId,
          pin
        });
        ownerAuthorizationId = authorization.authorizationId;
      }
      await enqueueOperation({
        type: "STOCK_ADJUSTMENT",
        payload: {
          adjustmentId: crypto.randomUUID(),
          productId: product.id,
          quantityDelta: delta.trim(),
          reason: reason.trim(),
          ownerAuthorizationId
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      await applySignedStockDeltas(branchId, [{ productId: product.id, quantityDelta: delta.trim() }]);
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      onDone(product.id, delta.trim());
    } catch (err) {
      setError(err instanceof Error && err.message ? "No se pudo autorizar: PIN incorrecto o autorización rechazada." : "No se pudo guardar el ajuste.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Ajustar stock">
        <h2>Ajustar stock: {product.name}</h2>
        <p className="pos-change">
          Actual: <strong>{product.onHand ?? "0"} {product.unitLabel}</strong>
        </p>
        <label className="pos-field">
          Cantidad (usa − para restar, ej. −2)
          <input
            type="text"
            inputMode="decimal"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            autoFocus
          />
        </label>
        <label className="pos-field">
          Motivo
          <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Compra al proveedor, merma, corrección…" />
        </label>
        {role !== "OWNER" ? (
          <label className="pos-field">
            PIN del dueño
            <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" />
          </label>
        ) : null}
        {error ? <p className="pos-error" role="alert">{error}</p> : null}
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : role !== "OWNER" ? "Autorizar y ajustar" : "Guardar ajuste"}
          </button>
        </div>
      </div>
    </div>
  );
}
