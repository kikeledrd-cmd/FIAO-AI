"use client";

import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import { applySignedStockDeltas, listCatalogLocally, loadCatalogFromServer, saveCatalogLocally } from "@/lib/offline/catalog";
import { requestOwnerAuthorization } from "@/lib/offline/owner-authorize";
import { listSuppliersLocally, loadSuppliersFromServer, saveSuppliersLocally, type LocalSupplier } from "@/lib/offline/suppliers";
import { syncNow } from "@/lib/offline/sync-client";
import { useEffect, useMemo, useState } from "react";
import { formatMoneyCents } from "../sales/sales-screen";
import type { CatalogProduct } from "@fiao/contracts/sales";

interface PurchaseDraftLine {
  productId: string;
  quantity: string;
  unitCostCents: number;
}

export function InventoryScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [suppliers, setSuppliers] = useState<LocalSupplier[]>([]);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<CatalogProduct | null>(null);
  const [purchasing, setPurchasing] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    async function loadSuppliers() {
      try {
        if (navigator.onLine) {
          const fresh = await loadSuppliersFromServer(activeBranchId);
          if (cancelled) return;
          setSuppliers(fresh);
          await saveSuppliersLocally(fresh).catch(() => undefined);
        } else {
          const local = await listSuppliersLocally(activeBranchId);
          if (cancelled) return;
          if (local.length > 0) setSuppliers(local);
        }
      } catch {
        if (cancelled) return;
        const local = await listSuppliersLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setSuppliers(local);
      }
    }
    void loadSuppliers();
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

      <div className="customers-actions">
        <button type="button" className="pos-pay" onClick={() => setPurchasing(true)}>
          + Registrar compra
        </button>
      </div>

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

      {purchasing ? (
        <PurchaseSheet
          products={products}
          suppliers={suppliers}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          role={user.role}
          online={online}
          onCancel={() => setPurchasing(false)}
          onDone={(lines, costAfter) => {
            setProducts((current) =>
              current.map((product) => {
                const line = lines.find((candidate) => candidate.productId === product.id);
                if (!line || product.onHand === null) return product;
                const cost = costAfter.find((entry) => entry.productId === product.id);
                return {
                  ...product,
                  onHand: String(Number(product.onHand) + Number(line.quantity)),
                  ...(cost ? { costCents: cost.costCents } : {})
                };
              })
            );
            setPurchasing(false);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function PurchaseSheet({
  products,
  suppliers,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  role,
  online,
  onCancel,
  onDone
}: {
  products: CatalogProduct[];
  suppliers: LocalSupplier[];
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  role: "OWNER" | "CASHIER";
  online: boolean;
  onCancel: () => void;
  onDone: (lines: PurchaseDraftLine[], costAfter: { productId: string; costCents: number }[]) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<PurchaseDraftLine[]>([{ productId: products[0]?.id ?? "", quantity: "1", unitCostCents: 0 }]);
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(index: number, patch: Partial<PurchaseDraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const valid =
    lines.length > 0 &&
    lines.every((line) => line.productId !== "" && Number(line.quantity) > 0 && line.unitCostCents > 0) &&
    (role === "OWNER" || pin.length >= 4);

  const totalCents = lines.reduce((sum, line) => sum + Math.round(line.unitCostCents * Number(line.quantity)), 0);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const operationId = crypto.randomUUID();
      let ownerAuthorizationId: string | null = null;
      if (role !== "OWNER") {
        if (!online) {
          setError("La compra requiere conexión para validar el PIN del dueño. Conéctate e inténtalo de nuevo.");
          return;
        }
        const authorization = await requestOwnerAuthorization({
          branchId,
          purpose: "PURCHASE",
          targetOperationId: operationId,
          pin
        });
        ownerAuthorizationId = authorization.authorizationId;
      }
      const purchaseId = crypto.randomUUID();
      await enqueueOperation({
        type: "PURCHASE",
        payload: {
          purchaseId,
          supplierId: supplierId || null,
          lines,
          note: note.trim() || null,
          ownerAuthorizationId,
          occurredAt: new Date().toISOString()
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      await applySignedStockDeltas(
        branchId,
        lines.map((line) => ({ productId: line.productId, quantityDelta: `+${line.quantity}` }))
      );
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      // Costo promedio móvil local (misma fórmula que el dominio).
      const costAfter: { productId: string; costCents: number }[] = lines.map((line) => {
        const product = products.find((candidate) => candidate.id === line.productId);
        const oldCost = product?.costCents ?? 0;
        const oldQty = Number(product?.onHand ?? "0");
        const newCost =
          oldCost === 0 || oldQty === 0
            ? line.unitCostCents
            : Math.round((oldCost * oldQty + line.unitCostCents * Number(line.quantity)) / (oldQty + Number(line.quantity)));
        return { productId: line.productId, costCents: newCost };
      });
      onDone(lines, costAfter);
    } catch {
      setError("No se pudo registrar la compra: PIN incorrecto o autorización rechazada.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Registrar compra">
        <h2>Registrar compra</h2>
        <label className="pos-field">
          Proveedor (opcional)
          <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Sin proveedor</option>
            {suppliers.map((supplier) => (
              <option key={supplier.supplierId} value={supplier.supplierId}>{supplier.name}</option>
            ))}
          </select>
        </label>

        {lines.map((line, index) => (
          <div key={index} className="purchase-line">
            <label className="pos-field">
              Producto
              <select
                value={line.productId}
                onChange={(event) => updateLine(index, { productId: event.target.value })}
              >
                <option value="">Seleccionar…</option>
                {products.filter((product) => product.stockControl).map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <div className="purchase-line-row">
              <label className="pos-field">
                Cantidad
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                />
              </label>
              <label className="pos-field">
                Costo unitario (RD$)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={line.unitCostCents === 0 ? "" : (line.unitCostCents / 100).toFixed(2)}
                  onChange={(event) => updateLine(index, { unitCostCents: Math.round(Number(event.target.value) * 100) })}
                />
              </label>
            </div>
            {index > 0 ? (
              <button type="button" className="pos-clear" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                Quitar línea
              </button>
            ) : null}
          </div>
        ))}

        <button
          type="button"
          className="pos-pay"
          onClick={() => setLines((current) => [...current, { productId: products.find((product) => product.stockControl)?.id ?? "", quantity: "1", unitCostCents: 0 }])}
        >
          + Agregar línea
        </button>

        <label className="pos-field">
          Nota (opcional)
          <input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Compra semanal…" />
        </label>

        {role !== "OWNER" ? (
          <label className="pos-field">
            PIN del dueño
            <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" />
          </label>
        ) : null}

        <p className="pos-change">
          Total compra: <strong>{formatMoneyCents(totalCents)}</strong>
        </p>
        {error ? <p className="pos-error" role="alert">{error}</p> : null}

        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : "Registrar compra"}
          </button>
        </div>
      </div>
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
