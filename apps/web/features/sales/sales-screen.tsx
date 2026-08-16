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
import { syncNow } from "@/lib/offline/sync-client";
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
  CARD: "Tarjeta"
};

export function SalesScreen() {
  const { user, branches, activeBranchId, online } = useAppShell();
  const { syncing, sync } = useSync();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<{ saleId: string; totalCents: number; methodLabel: string } | null>(null);
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

  async function confirmSale(payments: SalePayment[]) {
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
        payload: { saleId, lines, payments },
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
      setReceipt({ saleId, totalCents, methodLabel });
      setCart([]);
      setPaying(false);
      void sync();
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <ReceiptView
        receipt={receipt}
        branchName={branchName}
        onClose={() => setReceipt(null)}
        onNewSale={() => setReceipt(null)}
      />
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

function incrementQuantity(quantity: string): string {
  return String(Math.min(999, Number(quantity) + 1));
}

function decrementQuantity(quantity: string): string {
  return String(Math.max(0, Number(quantity) - 1));
}

function PaymentSheet({
  totalCents,
  online,
  syncing,
  submitting,
  onCancel,
  onConfirm
}: {
  totalCents: number;
  online: boolean;
  syncing: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (payments: SalePayment[]) => Promise<void>;
}) {
  const [method, setMethod] = useState<SalePaymentMethod>("CASH");
  const [cashAmount, setCashAmount] = useState<string>(String(Math.round(totalCents / 100)));
  const [mixed, setMixed] = useState(false);
  const [secondMethod, setSecondMethod] = useState<SalePaymentMethod>("TRANSFER");

  const cashAmountCents = Math.round(Number(cashAmount) * 100);
  const changeCents = method === "CASH" && !mixed ? cashAmountCents - totalCents : 0;

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
              </select>
            </label>
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
            disabled={!payments || submitting}
            onClick={() => {
              if (payments) void onConfirm(payments);
            }}
          >
            {submitting ? "Registrando…" : syncing ? "Sincronizando…" : online ? "Confirmar venta" : "Guardar offline"}
          </button>
        </div>
      </div>
    </div>
  );
}
