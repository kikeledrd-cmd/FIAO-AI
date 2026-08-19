"use client";

import { useEffect, useMemo, useState } from "react";
import type { Order } from "@fiao/contracts/orders";
import type { CatalogProduct } from "@fiao/contracts/sales";
import { saleLineTotalCents } from "@fiao/domain/sales/sale-policy";
import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import { listOrdersLocally, loadOrdersFromServer, saveOrdersLocally } from "@/lib/offline/orders";
import { listCatalogLocally, loadCatalogFromServer, saveCatalogLocally } from "@/lib/offline/catalog";
import { syncNow } from "@/lib/offline/sync-client";
import { formatMoneyCents } from "../sales/sales-screen";

const STATUS_LABEL: Record<Order["status"], string> = {
  NEW: "Nuevo",
  PREPARING: "Preparando",
  READY: "Listo",
  ON_THE_WAY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado"
};

interface DraftLine {
  product: CatalogProduct;
  quantity: string;
}

export function OrdersScreen() {
  const { user, activeBranchId, online } = useAppShell();
  const { sync } = useSync();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [delivering, setDelivering] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      try {
        if (navigator.onLine) {
          const [freshOrders, freshProducts] = await Promise.all([
            loadOrdersFromServer(activeBranchId),
            loadCatalogFromServer(activeBranchId)
          ]);
          if (cancelled) return;
          setOrders(freshOrders);
          setProducts(freshProducts);
          await Promise.all([
            saveOrdersLocally(freshOrders).catch(() => undefined),
            saveCatalogLocally(freshProducts).catch(() => undefined)
          ]);
        } else {
          const [localOrders, localProducts] = await Promise.all([
            listOrdersLocally(activeBranchId),
            listCatalogLocally(activeBranchId)
          ]);
          if (cancelled) return;
          setOrders(localOrders);
          setProducts(localProducts);
          if (localOrders.length === 0) setLoadError("Sin conexión y sin pedidos guardados en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listOrdersLocally(activeBranchId).catch(() => []);
        setOrders(local);
        if (local.length === 0) setLoadError("No se pudieron cargar los pedidos.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const active = useMemo(
    () => orders.filter((order) => order.status !== "DELIVERED" && order.status !== "CANCELLED"),
    [orders]
  );
  const closed = useMemo(
    () => orders.filter((order) => order.status === "DELIVERED" || order.status === "CANCELLED"),
    [orders]
  );
  const exceptions = useMemo(() => orders.filter((order) => order.exceptionReason), [orders]);

  function applyLocal(orderId: string, patch: Partial<Order>) {
    setOrders((current) =>
      current.map((order) => (order.orderId === orderId ? { ...order, ...patch } : order))
    );
  }

  return (
    <div className="customers-screen">
      <div className="customers-actions">
        <button type="button" className="pos-pay" onClick={() => setCreating(true)}>
          + Nuevo pedido
        </button>
      </div>

      {loadError ? <p className="pos-error" role="alert">{loadError}</p> : null}

      {exceptions.length > 0 ? (
        <>
          <h2 className="section-title">Excepciones</h2>
          <ul className="customers-list" aria-label="Pedidos con excepción">
            {exceptions.map((order) => (
              <OrderItem key={order.orderId} order={order} onDeliver={() => setDelivering(order)} onMutate={applyLocal} ownerId={user.ownerId} branchId={activeBranchId} actorUserId={user.id} deviceId={user.deviceId} />
            ))}
          </ul>
        </>
      ) : null}

      <h2 className="section-title">Pedidos activos</h2>
      {active.length === 0 ? <p className="pos-empty">No hay pedidos activos.</p> : null}
      <ul className="customers-list" aria-label="Pedidos activos">
        {active.map((order) => (
          <OrderItem key={order.orderId} order={order} onDeliver={() => setDelivering(order)} onMutate={applyLocal} ownerId={user.ownerId} branchId={activeBranchId} actorUserId={user.id} deviceId={user.deviceId} />
        ))}
      </ul>

      <h2 className="section-title">Historial</h2>
      {closed.length === 0 ? <p className="pos-empty">Sin pedidos entregados ni cancelados.</p> : null}
      <ul className="customers-list" aria-label="Historial de pedidos">
        {closed.map((order) => (
          <OrderItem key={order.orderId} order={order} onMutate={applyLocal} ownerId={user.ownerId} branchId={activeBranchId} actorUserId={user.id} deviceId={user.deviceId} />
        ))}
      </ul>

      {creating ? (
        <CreateOrderSheet
          products={products}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setCreating(false)}
          onCreated={(order) => {
            setOrders((current) => [order, ...current]);
            setCreating(false);
            void sync();
          }}
        />
      ) : null}

      {delivering ? (
        <DeliverOrderSheet
          order={delivering}
          ownerId={user.ownerId}
          branchId={activeBranchId}
          actorUserId={user.id}
          deviceId={user.deviceId}
          online={online}
          onCancel={() => setDelivering(null)}
          onDone={() => {
            applyLocal(delivering.orderId, { status: "DELIVERED" });
            setDelivering(null);
            void sync();
          }}
        />
      ) : null}
    </div>
  );
}

function OrderItem({
  order,
  onDeliver,
  onMutate,
  ownerId,
  branchId,
  actorUserId,
  deviceId
}: {
  order: Order;
  onDeliver?: () => void;
  onMutate: (orderId: string, patch: Partial<Order>) => void;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
}) {
  const [busy, setBusy] = useState(false);
  const lineTotal = order.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  async function mutate(type: string, payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await enqueueOperation({ type, payload, ownerId, branchId, actorUserId, deviceId });
      if (navigator.onLine) {
        try {
          await syncNow(branchId);
        } catch {
          // Queda en la cola.
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    await mutate("ORDER_ACCEPT", { orderId: order.orderId, branchId, occurredAt: new Date().toISOString() });
    onMutate(order.orderId, { status: "PREPARING" });
  }

  async function ready() {
    await mutate("ORDER_ADVANCE", { orderId: order.orderId, branchId, nextStatus: "READY", occurredAt: new Date().toISOString() });
    onMutate(order.orderId, { status: "READY" });
  }

  async function onTheWay() {
    await mutate("ORDER_ADVANCE", { orderId: order.orderId, branchId, nextStatus: "ON_THE_WAY", occurredAt: new Date().toISOString() });
    onMutate(order.orderId, { status: "ON_THE_WAY" });
  }

  async function cancel() {
    await mutate("ORDER_CANCEL", { orderId: order.orderId, branchId, reason: "Cancelado desde la pantalla de pedidos", occurredAt: new Date().toISOString() });
    onMutate(order.orderId, { status: "CANCELLED" });
  }

  return (
    <li className="customers-item">
      <div className="customers-info">
        <strong>{order.source === "WHATSAPP" ? "WhatsApp" : order.source === "MANUAL" ? "Manual" : "Repetido"}</strong>
        <span>{order.lines.length} producto{order.lines.length === 1 ? "" : "s"} · {formatMoneyCents(lineTotal)}</span>
        <small>{STATUS_LABEL[order.status]}{order.deliveryName ? ` · ${order.deliveryName}` : ""}</small>
        {order.exceptionReason ? <small className="pos-warn">Excepción: {order.exceptionReason}</small> : null}
      </div>
      <div className="customers-actions-row">
        {order.status === "NEW" ? (
          <>
            <button type="button" className="customers-abono" disabled={busy} onClick={() => void accept()}>Aceptar</button>
            <button type="button" className="pos-cancel" disabled={busy} onClick={() => void cancel()}>Cancelar</button>
          </>
        ) : order.status === "PREPARING" ? (
          <>
            <button type="button" className="customers-abono" disabled={busy} onClick={() => void ready()}>Listo</button>
            <button type="button" className="pos-cancel" disabled={busy} onClick={() => void cancel()}>Cancelar</button>
          </>
        ) : order.status === "READY" ? (
          <>
            <button type="button" className="customers-abono" disabled={busy} onClick={() => void onTheWay()}>En camino</button>
            <button type="button" className="pos-cancel" disabled={busy} onClick={() => void cancel()}>Cancelar</button>
          </>
        ) : order.status === "ON_THE_WAY" && onDeliver ? (
          <>
            <button type="button" className="customers-abono" disabled={busy} onClick={onDeliver}>Entregar</button>
            <button type="button" className="pos-cancel" disabled={busy} onClick={() => void cancel()}>Cancelar</button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function CreateOrderSheet({
  products,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onCreated
}: {
  products: CatalogProduct[];
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  online: boolean;
  onCancel: () => void;
  onCreated: (order: Order) => void;
}) {
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [deliveryName, setDeliveryName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalCents = useMemo(
    () => draft.reduce((sum, line) => sum + saleLineTotalCents(line.product.priceCents, line.quantity), 0),
    [draft]
  );
  const valid = draft.length > 0;

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
      const orderId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const lines = draft.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        priceCents: line.product.priceCents
      }));
      await enqueueOperation({
        type: "ORDER_CREATE",
        payload: {
          orderId,
          branchId,
          source: "MANUAL",
          customerId: null,
          lines,
          deliveryName: deliveryName.trim() || null,
          deliveryAddress: null,
          deliveryFeeCents: 0,
          notes: null,
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
          // Queda en la cola.
        }
      }
      const created: Order = {
        orderId,
        ownerId,
        branchId,
        source: "MANUAL",
        status: "NEW",
        customerId: null,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          priceCents: line.priceCents,
          lineTotalCents: saleLineTotalCents(line.priceCents, line.quantity)
        })),
        deliveryName: deliveryName.trim() || null,
        deliveryAddress: null,
        deliveryFeeCents: 0,
        totalCents,
        notes: null,
        exceptionReason: null,
        saleId: null,
        createdAt: occurredAt,
        timeline: []
      };
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Nuevo pedido">
        <h2>Nuevo pedido</h2>

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
          Entrega (nombre o referencia)
          <input type="text" value={deliveryName} onChange={(event) => setDeliveryName(event.target.value)} placeholder="Calle 5, casa azul" />
        </label>

        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void submit()}>
            {submitting ? "Guardando…" : online ? "Crear pedido" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliverOrderSheet({
  order,
  ownerId,
  branchId,
  actorUserId,
  deviceId,
  online,
  onCancel,
  onDone
}: {
  order: Order;
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
  const total = order.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await enqueueOperation({
        type: "ORDER_DELIVER",
        payload: {
          orderId: order.orderId,
          branchId,
          payments: [{ method, amountCents: total }],
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
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Entregar pedido">
        <h2>Entregar pedido</h2>
        <p className="pos-change">
          Total a cobrar: <strong>{formatMoneyCents(total)}</strong>
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
          <button type="button" className="pos-confirm" disabled={total <= 0 || submitting} onClick={() => void submit()}>
            {submitting ? "Entregando…" : online ? "Confirmar entrega" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}
