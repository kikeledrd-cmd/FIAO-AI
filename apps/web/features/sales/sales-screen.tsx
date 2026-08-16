"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogProduct, SaleLine, SalePayment, SalePaymentMethod } from "@fiao/contracts/sales";
import { subtotalCents } from "@fiao/domain/sales/sale-policy";
import { useAppShell } from "@/components/app-shell";
import { useSync } from "@/features/sync/sync-provider";
import { enqueueOperation } from "@/lib/offline/queue";
import {
  adjustLocalStock,
  listCatalogLocally,
  loadCatalogFromServer,
  saveCatalogLocally
} from "@/lib/offline/catalog";
import { listCustomersLocally, loadCustomersFromServer, saveCustomersLocally, type CustomerWithBalance } from "@/lib/offline/customers";
import { requestOwnerAuthorization } from "@/lib/offline/owner-authorize";
import { syncNow } from "@/lib/offline/sync-client";
import { applySignedStockDeltas } from "@/lib/offline/catalog";
import { ReceiptView } from "./receipt";

export function formatMoneyCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const pesos = Math.floor(absolute / 100);
  const centavos = String(absolute % 100).padStart(2, "0");
  return `${sign}RD$${pesos.toLocaleString("es-DO")}.${centavos}`;
}

interface CartLine {
  product: CatalogProduct;
  quantity: string;
}

const PAYMENT_LABEL: Record<SalePaymentMethod, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CARD: "Tarjeta",
  FIADO: "Fiado"
};

export function SalesScreen() {
  const { user, branches, activeBranchId, online } = useAppShell();
  const { syncing, sync } = useSync();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<{
    saleId: string;
    totalCents: number;
    methodLabel: string;
    lines: { productId: string; quantity: string }[];
    fiadoCents: number;
    customerId?: string;
  } | null>(null);
  const [reversing, setReversing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const branchName = branches.find((branch) => branch.id === activeBranchId)?.name ?? "Sucursal";

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setCatalogError(null);
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
          else setCatalogError("Sin conexión y sin catálogo guardado en este dispositivo.");
        }
      } catch {
        if (cancelled) return;
        const local = await listCatalogLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setProducts(local);
        else setCatalogError("No se pudo cargar el catálogo.");
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomers() {
      try {
        if (navigator.onLine) {
          const fresh = await loadCustomersFromServer(activeBranchId);
          if (cancelled) return;
          setCustomers(fresh);
          await saveCustomersLocally(fresh).catch(() => undefined);
        } else {
          const local = await listCustomersLocally(activeBranchId);
          if (cancelled) return;
          if (local.length > 0) setCustomers(local);
        }
      } catch {
        if (cancelled) return;
        const local = await listCustomersLocally(activeBranchId).catch(() => []);
        if (local.length > 0) setCustomers(local);
      }
    }
    void loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((product) => product.name.toLowerCase().includes(needle));
  }, [products, query]);

  const cartLines = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    return cart
      .map((line) => {
        const product = byId.get(line.product.id);
        return product ? { product, quantity: line.quantity } : null;
      })
      .filter((line): line is CartLine => line !== null);
  }, [cart, products]);

  const totalCents = useMemo(() => {
    const lines: SaleLine[] = cartLines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      priceCents: line.product.priceCents
    }));
    try {
      return subtotalCents(lines);
    } catch {
      return 0;
    }
  }, [cartLines]);

  function addToCart(product: CatalogProduct) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: incrementQuantity(line.quantity) }
            : line
        );
      }
      return [...current, { product, quantity: "1" }];
    });
  }

  function changeQuantity(productId: string, delta: 1 | -1) {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: delta === 1 ? incrementQuantity(line.quantity) : decrementQuantity(line.quantity) }
            : line
        )
        .filter((line) => line.quantity !== "0")
    );
  }

  function clearCart() {
    setCart([]);
  }

  async function confirmSale(payments: SalePayment[], customerId?: string) {
    if (cartLines.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const lines: SaleLine[] = cartLines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        priceCents: line.product.priceCents
      }));
      const saleId = crypto.randomUUID();
      await enqueueOperation({
        type: "SALE",
        payload: { saleId, customerId, lines, payments },
        ownerId: user.ownerId,
        branchId: activeBranchId,
        actorUserId: user.id,
        deviceId: user.deviceId
      });
      await adjustLocalStock(
        activeBranchId,
        lines.map((line) => ({ productId: line.productId, quantity: line.quantity }))
      );
      if (navigator.onLine) {
        try {
          await syncNow(activeBranchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      setProducts((current) =>
        current.map((product) => {
          const line = lines.find((candidate) => candidate.productId === product.id);
          if (!line || !product.stockControl || product.onHand === null) return product;
          const whole = Math.max(0, Number(product.onHand) - Number(line.quantity));
          return { ...product, onHand: String(whole) };
        })
      );
      const methodLabel = payments.map((payment) => PAYMENT_LABEL[payment.method]).join(" + ");
      const fiadoCents = payments.filter((payment) => payment.method === "FIADO").reduce((sum, payment) => sum + payment.amountCents, 0);
      if (fiadoCents > 0 && customerId) {
        setCustomers((current) =>
          current.map((customer) =>
            customer.customerId === customerId
              ? { ...customer, balanceCents: customer.balanceCents + fiadoCents }
              : customer
          )
        );
      }
      setReceipt({
        saleId,
        totalCents,
        methodLabel,
        lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        fiadoCents,
        ...(customerId ? { customerId } : {})
      });
      setCart([]);
      setPaying(false);
      void sync();
    } finally {
      setSubmitting(false);
    }
  }

  async function reverseSale(reason: string, pin: string): Promise<void> {
    if (!receipt || submitting) return;
    setSubmitting(true);
    try {
      const operationId = crypto.randomUUID();
      let ownerAuthorizationId: string | null = null;
      if (user.role !== "OWNER") {
        if (!navigator.onLine) {
          throw new Error("OFFLINE_REQUIRES_OWNER");
        }
        const authorization = await requestOwnerAuthorization({
          branchId: activeBranchId,
          purpose: "SALE_REVERSAL",
          targetOperationId: operationId,
          pin
        });
        ownerAuthorizationId = authorization.authorizationId;
      }
      await enqueueOperation({
        type: "SALE_REVERSAL",
        payload: {
          reversalId: crypto.randomUUID(),
          saleId: receipt.saleId,
          reason: reason.trim(),
          ownerAuthorizationId
        },
        ownerId: user.ownerId,
        branchId: activeBranchId,
        actorUserId: user.id,
        deviceId: user.deviceId
      });
      // Restaurar stock local y saldo de fiado (proyección optimista).
      await applySignedStockDeltas(
        activeBranchId,
        receipt.lines.map((line) => ({ productId: line.productId, quantityDelta: `+${line.quantity}` }))
      );
      if (receipt.fiadoCents > 0 && receipt.customerId) {
        setCustomers((current) =>
          current.map((customer) =>
            customer.customerId === receipt.customerId
              ? { ...customer, balanceCents: Math.max(0, customer.balanceCents - receipt.fiadoCents) }
              : customer
          )
        );
      }
      setProducts((current) =>
        current.map((product) => {
          const line = receipt.lines.find((candidate) => candidate.productId === product.id);
          if (!line || !product.stockControl || product.onHand === null) return product;
          return { ...product, onHand: String(Number(product.onHand) + Number(line.quantity)) };
        })
      );
      if (navigator.onLine) {
        try {
          await syncNow(activeBranchId);
        } catch {
          // Queda en la cola; el SyncProvider lo reintentará.
        }
      }
      setReversing(false);
      setReceipt(null);
      setCart([]);
      void sync();
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <>
        <ReceiptView
          receipt={receipt}
          branchName={branchName}
          onClose={() => setReceipt(null)}
          onNewSale={() => setReceipt(null)}
          onReverse={() => setReversing(true)}
        />
        {reversing ? (
          <ReverseSaleSheet
            totalCents={receipt.totalCents}
            requiresPin={user.role !== "OWNER"}
            online={online}
            submitting={submitting}
            onCancel={() => setReversing(false)}
            onConfirm={reverseSale}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="pos-screen">
      <div className="pos-search">
        <input
          type="search"
          placeholder="Buscar producto…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar producto"
        />
      </div>

      {catalogError ? <p className="pos-error" role="alert">{catalogError}</p> : null}

      {cartLines.length > 0 ? (
        <div className="pos-cart">
          <ul className="pos-cart-list">
            {cartLines.map((line) => (
              <li key={line.product.id} className="pos-cart-item">
                <div className="pos-cart-info">
                  <strong>{line.product.name}</strong>
                  <span>
                    {line.quantity} × {formatMoneyCents(line.product.priceCents)}
                  </span>
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
          <button type="button" className="pos-clear" onClick={clearCart}>Vaciar carrito</button>
        </div>
      ) : null}

      <ul className="pos-grid" aria-label="Productos">
        {filtered.map((product) => (
          <li key={product.id}>
            <button type="button" className="pos-product" onClick={() => addToCart(product)}>
              <strong>{product.name}</strong>
              <span>{formatMoneyCents(product.priceCents)}</span>
              {product.stockControl && product.onHand !== null ? (
                <small>{product.onHand} {product.unitLabel}</small>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {cartLines.length > 0 ? (
        <div className="pos-checkout-bar">
          <strong>{formatMoneyCents(totalCents)}</strong>
          <button type="button" className="pos-pay" onClick={() => setPaying(true)} disabled={submitting}>
            Cobrar
          </button>
        </div>
      ) : null}

      {paying ? (
        <PaymentSheet
          totalCents={totalCents}
          customers={customers}
          online={online}
          syncing={syncing}
          submitting={submitting}
          onCancel={() => setPaying(false)}
          onConfirm={confirmSale}
        />
      ) : null}
    </div>
  );
}

function ReverseSaleSheet({
  totalCents,
  requiresPin,
  online,
  submitting,
  onCancel,
  onConfirm
}: {
  totalCents: number;
  requiresPin: boolean;
  online: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, pin: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length > 0 && (!requiresPin || pin.length >= 4);

  async function confirm() {
    if (!valid || submitting) return;
    setError(null);
    if (requiresPin && !online) {
      setError("Anular requiere conexión para validar el PIN del dueño. Conéctate e inténtalo de nuevo.");
      return;
    }
    try {
      await onConfirm(reason, pin);
    } catch (err) {
      setError(
        err instanceof Error && err.message === "OFFLINE_REQUIRES_OWNER"
          ? "Anular requiere conexión para validar el PIN del dueño. Conéctate e inténtalo de nuevo."
          : "No se pudo anular: PIN incorrecto o autorización rechazada."
      );
    }
  }

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Anular venta">
        <h2>Anular venta de {formatMoneyCents(totalCents)}</h2>
        <p className="receipt-note">La venta se revierte y el stock vuelve al inventario. Queda registrada en la auditoría.</p>
        <label className="pos-field">
          Motivo de la anulación
          <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cliente devolvió el producto…" autoFocus />
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
          <button type="button" className="pos-confirm" disabled={!valid || submitting} onClick={() => void confirm()}>
            {submitting ? "Anulando…" : "Confirmar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}

function incrementQuantity(quantity: string): string {
  return String(Math.min(999, Number(quantity) + 1));
}

function decrementQuantity(quantity: string): string {
  return String(Math.max(0, Number(quantity) - 1));
}

function PaymentSheet({
  totalCents,
  customers,
  online,
  syncing,
  submitting,
  onCancel,
  onConfirm
}: {
  totalCents: number;
  customers: CustomerWithBalance[];
  online: boolean;
  syncing: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (payments: SalePayment[], customerId?: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<SalePaymentMethod>("CASH");
  const [cashAmount, setCashAmount] = useState<string>(String(Math.round(totalCents / 100)));
  const [mixed, setMixed] = useState(false);
  const [secondMethod, setSecondMethod] = useState<SalePaymentMethod>("TRANSFER");
  const [customerId, setCustomerId] = useState<string>("");

  const cashAmountCents = Math.round(Number(cashAmount) * 100);
  const changeCents = method === "CASH" && !mixed ? cashAmountCents - totalCents : 0;

  const selectedCustomer = customers.find((customer) => customer.customerId === customerId);
  const fiadoExceedsLimit =
    method === "FIADO" && selectedCustomer
      ? selectedCustomer.balanceCents + totalCents > selectedCustomer.creditLimitCents
      : false;

  function buildPayments(): SalePayment[] | null {
    if (!mixed) {
      if (method === "CASH") {
        if (cashAmountCents < totalCents) return null;
        return [{ method: "CASH", amountCents: totalCents }];
      }
      return [{ method, amountCents: totalCents }];
    }
    // Mixto: efectivo + otro método. El efectivo no puede exceder el total.
    if (cashAmountCents > totalCents || cashAmountCents < 0) return null;
    const rest = totalCents - cashAmountCents;
    if (rest === 0) return null;
    return [
      ...(cashAmountCents > 0 ? [{ method: "CASH" as const, amountCents: cashAmountCents }] : []),
      { method: secondMethod, amountCents: rest }
    ];
  }

  const payments = buildPayments();
  const fiadoSelected = method === "FIADO";
  const canConfirm =
    payments !== null && (!fiadoSelected || customerId !== "") && !fiadoExceedsLimit;

  return (
    <div className="pos-modal-backdrop" role="presentation">
      <div className="pos-modal" role="dialog" aria-modal="true" aria-label="Cobrar venta">
        <h2>Cobrar {formatMoneyCents(totalCents)}</h2>

        <div className="pos-methods">
          {(Object.keys(PAYMENT_LABEL) as SalePaymentMethod[]).map((option) => (
            <button
              key={option}
              type="button"
              className={method === option && !mixed ? "active" : ""}
              onClick={() => {
                setMethod(option);
                setMixed(false);
              }}
            >
              {PAYMENT_LABEL[option]}
            </button>
          ))}
        </div>

        {method === "CASH" ? (
          <label className="pos-field">
            Efectivo recibido
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={cashAmount}
              onChange={(event) => setCashAmount(event.target.value)}
            />
          </label>
        ) : null}

        {method === "CASH" && !mixed ? (
          <p className="pos-change">
            Vuelto: <strong>{formatMoneyCents(Math.max(0, changeCents))}</strong>
          </p>
        ) : null}

        {fiadoSelected ? (
          <div className="pos-fiado-customer">
            <label className="pos-field">
              Cliente a fiado
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Seleccionar cliente…</option>
                {customers.map((customer) => (
                  <option key={customer.customerId} value={customer.customerId}>
                    {customer.name} — saldo {formatMoneyCents(customer.balanceCents)}
                  </option>
                ))}
              </select>
            </label>
            {fiadoExceedsLimit ? (
              <p className="pos-error" role="alert">
                Este fiado excede el límite de crédito de {selectedCustomer?.name} ({formatMoneyCents(selectedCustomer?.creditLimitCents ?? 0)}).
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="pos-mixed-toggle">
          <input type="checkbox" checked={mixed} onChange={(event) => setMixed(event.target.checked)} />
          Pago mixto (efectivo + otro método)
        </label>

        {mixed ? (
          <div className="pos-mixed-row">
            <label className="pos-field">
              Efectivo
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={cashAmount}
                onChange={(event) => setCashAmount(event.target.value)}
              />
            </label>
            <label className="pos-field">
              Segundo método
              <select value={secondMethod} onChange={(event) => setSecondMethod(event.target.value as SalePaymentMethod)}>
                <option value="TRANSFER">Transferencia</option>
                <option value="CARD">Tarjeta</option>
                <option value="FIADO">Fiado</option>
              </select>
            </label>
          </div>
        ) : null}

        {mixed && secondMethod === "FIADO" ? (
          <div className="pos-fiado-customer">
            <label className="pos-field">
              Cliente a fiado
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">Seleccionar cliente…</option>
                {customers.map((customer) => (
                  <option key={customer.customerId} value={customer.customerId}>
                    {customer.name} — saldo {formatMoneyCents(customer.balanceCents)}
                  </option>
                ))}
              </select>
            </label>
            {fiadoExceedsLimit ? (
              <p className="pos-error" role="alert">
                Este fiado excede el límite de crédito de {selectedCustomer?.name} ({formatMoneyCents(selectedCustomer?.creditLimitCents ?? 0)}).
              </p>
            ) : null}
          </div>
        ) : null}

        {payments ? (
          <p className="pos-payments-preview">
            {payments.map((payment) => `${PAYMENT_LABEL[payment.method]}: ${formatMoneyCents(payment.amountCents)}`).join(" · ")}
          </p>
        ) : (
          <p className="pos-error" role="alert">El efectivo no cubre el total.</p>
        )}

        <div className="pos-modal-actions">
          <button type="button" className="pos-cancel" onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="button"
            className="pos-confirm"
            disabled={!canConfirm || submitting}
            onClick={() => {
              if (payments) void onConfirm(payments, customerId || undefined);
            }}
          >
            {submitting ? "Registrando…" : syncing ? "Sincronizando…" : online ? "Confirmar venta" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}

