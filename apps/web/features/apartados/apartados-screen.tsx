"use client";

import { useEffect, useMemo, useState } from "react";
import type { Apartado } from "@fiao/contracts/apartado";
import type { CatalogProduct } from "@fiao/contracts/sales";
import { saleLineTotalCents } from "@fiao/domain/sales/sale-policy";
import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import {
  listApartadosLocally,
  loadApartadosFromServer,
  saveApartadosLocally
} from "@/lib/offline/apartados";
import { listCatalogLocally, loadCatalogFromServer, saveCatalogLocally } from "@/lib/offline/catalog";
import { listCustomersLocally, loadCustomersFromServer, saveCustomersLocally, type CustomerWithBalance } from "@/lib/offline/customers";
import { requestOwnerAuthorization } from "@/lib/offline/owner-authorize";
import { syncNow } from "@/lib/offline/sync-client";
import { formatMoneyCents } from "../sales/sales-screen";

const STATUS_LABEL: Record<Apartado["status"], string> = {
  ACTIVE: "Activo",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado"
};

interface DraftLine {
  product: CatalogProduct;
  quantity: string;
}

export function ApartadosScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [apartados, setApartados] = useState<Apartado[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Apartado | null>(null);
  const [cancelling, setCancelling] = useState<Apartado | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const [freshApartados, freshProducts, freshCustomers] = await Promise.all([
            loadApartadosFromServer(activeBranchId),
            loadCatalogFromServer(activeBranchId),
            loadCustomersFromServer(activeBranchId)
          ]);
          if (cancelled) return;
          setApartados(freshApartados);
          setProducts(freshProducts);
          setCustomers(freshCustomers);
          await Promise.all([
            saveApartadosLocally(freshApartados).catch(() => undefined),
            saveCatalogLocally(freshProducts).catch(() => undefined),
            saveCustomersLocally(freshCustomers).catch(() => undefined)
          ]);
        } else {
          const [localApartados, localProducts, localCustomers] = await Promise.all([
            listApartadosLocally(activeBranchId),
            listCatalogLocally(activeBranchId),
            listCustomersLocally(activeBranchId)
          ]);
          if (cancelled) return;
          setApartados(localApartados);
          setProducts(localProducts);
          setCustomers(localCustomers);
          if (localApartados.length === 0) setLoadError("Sin conexión y sin apartados guardados en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listApartadosLocally(activeBranchId).catch(() => []);
        setApartados(local);
        if (local.length === 0) setLoadError("No se pudieron cargar los apartados.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const active = useMemo(() => apartados.filter((apartado) => apartado.status === "ACTIVE"), [apartados]);
  const inactive = useMemo(() => apartados.filter((apartado) => apartado.status !== "ACTIVE"), [apartados]);

  return (
    <div className="customers-screen">
      <div className="customers-actions">
        <button type="button" className="pos-pay" onClick={() => setCreating(true)}>
          + Nuevo apartado
        </button>
      </div>

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      <h2 className="section-title">Apartados activos</h2>
      {active.length === 0 ? <p className="pos-empty">No hay apartados activos.</p> : null}
      <ul className="customers-list" aria-label="Apartados activos">
        {active.map((apartado) => (
          <ApartadoItem
            key={apartado.apartadoId}
            apartado={apartado}
            customers={customers}
            onComplete={() => setCompleting(apartado)}
            onCancel={() => setCancelling(apartado)}
          />
        ))}
      </ul>

      <h2 className="section-title">Historial</h2>
      {inactive.length === 0 ? <p className="pos-empty">Sin apartados completados ni cancelados.</p> : null}
      <ul className="customers-list" aria-label="Historial de apartados">
        {inactive.map((apartado) => (
          <ApartadoItem key={apartado.apartadoId} apartado={apartado} customers={customers} />
        ))}
      </ul>

      {creating ? (
        <CreateApartadoSheet
          products={products}
          customers={customers}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setCreating(false)}
          onCreated={(apartado) => {
            setApartados((current) => [apartado, ...current]);
            setCreating(false);
            void sync();
          }}
        />
      ) : null}

      {completing ? (
        <CompleteApartadoSheet
          apartado={completing}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setCompleting(null)}
          onDone={() => {
            setApartados((current) =>
              current.map((item) =>
                item.apartadoId === completing.apartadoId ? { ...item, status: "COMPLETED" } : item
              )
            );
            setCompleting(null);
            void sync();
          }}
        />
      ) : null}

      {cancelling ? (
        <CancelApartadoSheet
          apartado={cancelling}
          requiresPin={user.role !== "OWNER"}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setCancelling(null)}
          onDone={() => {
            setApartados((current) =>
              current.map((item) =>
                item.apartadoId === cancelling.apartadoId ? { ...item, status: "CANCELLED" } : item
              )
            );
            setCancelling(null);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function ApartadoItem({
  apartado,
  customers,
  onComplete,
  onCancel
}: {
  apartado: Apartado;
  customers: CustomerWithBalance[];
  onComplete?: () => void;
  onCancel?: () => void;
}) {
  const customer = customers.find((candidate) => candidate.customerId === apartado.customerId);
  const remaining = apartado.totalCents - apartado.depositCents;
  return (
    <li className="customers-item">
      <div className="customers-info">
        <strong>{customer?.name ?? "Cliente"}</strong>
        <span>{apartado.lines.length} producto{apartado.lines.length === 1 ? "" : "s"} · {formatMoneyCents(apartado.totalCents)}</span>
        <small>
          Anticipo {formatMoneyCents(apartado.depositCents)} · Resta {formatMoneyCents(Math.max(0, remaining))} · {STATUS_LABEL[apartado.status]}
        </small>
        {apartado.promiseDate ? <small>Prometido: {new Date(apartado.promiseDate).toLocaleDateString("es-DO")}</small> : null}
      </div>
      {apartado.status === "ACTIVE" && onComplete && onCancel ? (
        <div className="customers-actions-row">
          <button type="button" className="customers-abono" onClick={onComplete}>Completar</button>
          <button type="button" className="pos-cancel" onClick={onCancel}>Cancelar</button>
        </div>
      ) : null}
    </li>
  );
}

function CreateApartadoSheet({
  products,
  customers,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onCreated
}: {
  products: CatalogProduct[];
  customers: CustomerWithBalance[];
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onCreated: (apartado: Apartado) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [deposit, setDeposit] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalCents = useMemo(
    () => draft.reduce((sum, line) => sum + saleLineTotalCents(line.product.priceCents, line.quantity), 0),
    [draft]
  );
  const depositCents = Math.round(Number(deposit) * 100);
  const valid =
    customerId !== "" &&
    draft.length > 0 &&
    Number.isFinite(depositCents) &&
    depositCents >= 0 &&
    depositCents <= totalCents;

  function addToDraft(product: CatalogProduct) {
    setDraft((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: String(Number(line.quantity) + 1) } : line
        );
      }
      return [...current, { product, quantity: "1" }];
    });
  }

  function changeQuantity(productId: string, delta: 1 | -1) {
    setDraft((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: String(Math.max(0, Number(line.quantity) + delta)) }
            : line
        )
        .filter((line) => line.quantity !== "0")
    );
  }

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const apartadoId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const lines = draft.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        priceCents: line.product.priceCents
      }));
      await enqueueOperation({
        type: "APARTADO_CREATE",
        payload: {
          apartadoId,
          branchId,
          customerId,
          lines,
          depositCents,
          totalCents,
          ...(promiseDate ? { promiseDate: new Date(`${promiseDate}T12:00:00`).toISOString() } : {}),
          notes: null,
          actorUserId,
          occurredAt
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      const created: Apartado = {
        apartadoId,
        ownerId,
        branchId,
        customerId,
        status: "ACTIVE",
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          priceCents: line.priceCents,
          lineTotalCents: saleLineTotalCents(line.priceCents, line.quantity)
        })),
        depositCents,
        totalCents,
        promiseDate: promiseDate ? new Date(`${promiseDate}T12:00:00`).toISOString() : null,
        notes: null,
        actorUserId,
        completedAt: null,
        cancelledAt: null,
        createdAt: occurredAt
      };
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Nuevo apartado">
        <h2>Nuevo apartado</h2>
        <label className="pos-field">
          Cliente
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Seleccionar cliente…</option>
            {customers.map((customer) => (
              <option key={customer.customerId} value={customer.customerId}>{customer.name}</option>
            ))}
          </select>
        </label>

        <div className="pos-cart">
          <ul className="pos-cart-list">
            {draft.map((line) => (
              <li key={line.product.id} className="pos-cart-item">
                <div className="pos-cart-info">
                  <strong>{line.product.name}</strong>
                  <span>{line.quantity} × {formatMoneyCents(line.product.priceCents)}</span>
                </div>
                <div className="pos-cart-qty">
                  <button type="button" aria-label={`Quitar uno de ${line.product.name}`} onClick={() => changeQuantity(line.product.id, -1)}>−</button>
                  <span>{line.quantity}</span>
                  <button type="button" aria-label={`Agregar uno de ${line.product.name}`} onClick={() => changeQuantity(line.product.id, 1)}>+</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="pos-total-row">
            <span>Total</span>
            <strong>{formatMoneyCents(totalCents)}</strong>
          </div>
        </div>

        <ul className="pos-grid" aria-label="Productos">
          {products.map((product) => (
            <li key={product.id}>
              <button type="button" className="pos-product" onClick={() => addToDraft(product)}>
                <strong>{product.name}</strong>
                <span>{formatMoneyCents(product.priceCents)}</span>
              </button>
            </li>
          ))}
        </ul>

        <label className="pos-field">
          Anticipo (RD$)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="0.00" />
        </label>
        <label className="pos-field">
          Fecha prometida (opcional)
          <input type="date" value={promiseDate} onChange={(event) => setPromiseDate(event.target.value)} />
        </label>

        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : online ? "Guardar apartado" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteApartadoSheet({
  apartado,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onDone
}: {
  apartado: Apartado;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<"CASH" | "TRANSFER" | "CARD">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const remaining = apartado.totalCents - apartado.depositCents;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await enqueueOperation({
        type: "APARTADO_COMPLETE",
        payload: {
          apartadoId: apartado.apartadoId,
          branchId,
          remainderPayments: [{ method, amountCents: remaining }],
          ownerAuthorizationId: null,
          occurredAt: new Date().toISOString()
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola.
        }
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Completar apartado">
        <h2>Completar apartado</h2>
        <p className="pos-change">
          Resta por cobrar: <strong>{formatMoneyCents(remaining)}</strong>
        </p>
        <div className="pos-methods">
          {(["CASH", "TRANSFER", "CARD"] as const).map((option) => (
            <button key={option} type="button" className={method === option ? "active" : ""} onClick={() => setMethod(option)}>
              {{ CASH: "Efectivo", TRANSFER: "Transferencia", CARD: "Tarjeta" }[option]}
            </button>
          ))}
        </div>
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={remaining <= 0 || submitting} onClick={() => void submit()}>
            {submitting ? "Completando…" : online ? "Completar apartado" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelApartadoSheet({
  apartado,
  requiresPin,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onDone
}: {
  apartado: Apartado;
  requiresPin: boolean;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const valid = reason.trim().length > 0 && (!requiresPin || pin.length >= 4);

  async function submit() {
    if (!valid || submitting) return;
    setError(null);
    if (requiresPin && !online) {
      setError("Cancelar requiere conexión para validar el PIN del dueño.");
      return;
    }
    setSubmitting(true);
    try {
      let ownerAuthorizationId: string | null = null;
      if (requiresPin) {
        const authorization = await requestOwnerAuthorization({
          branchId,
          purpose: "APARTADO_CANCEL",
          targetOperationId: crypto.randomUUID(),
          pin
        });
        ownerAuthorizationId = authorization.authorizationId;
      }
      await enqueueOperation({
        type: "APARTADO_CANCEL",
        payload: {
          apartadoId: apartado.apartadoId,
          branchId,
          reason: reason.trim(),
          ownerAuthorizationId,
          occurredAt: new Date().toISOString()
        },
        ownerId,
        branchId,
        actorUserId,
        deviceId
      });
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola.
        }
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message === "OFFLINE_REQUIRES_OWNER" ? "Sin conexión: no se puede validar el PIN." : "No se pudo cancelar: PIN incorrecto o autorización rechazada.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Cancelar apartado">
        <h2>Cancelar apartado</h2>
        <p className="receipt-note">Se libera la reserva de inventario y el anticipo queda como crédito a favor del cliente.</p>
        <label className="pos-field">
          Motivo
          <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cliente canceló…" autoFocus />
        </label>
        {requiresPin ? (
          <label className="pos-field">
            PIN del dueño
            <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" />
          </label>
        ) : null}
        {error ? <p className="pos-error" role="alert">{error}</p> : null}
        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Cancelando…" : "Confirmar cancelación"}
          </button>
        </div>
      </div>
    </div>
  );
}
