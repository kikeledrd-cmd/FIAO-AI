"use client";

import { formatMoneyCents } from "./sales-screen";

export interface ReceiptData {
  saleId: string;
  totalCents: number;
  methodLabel: string;
  lines: { productId: string; quantity: string }[];
  fiadoCents: number;
  customerId?: string;
}

export function ReceiptView({
  receipt,
  branchName,
  onNewSale,
  onReverse
}: {
  receipt: ReceiptData;
  branchName: string;
  onClose: () => void;
  onNewSale: () => void;
  onReverse: () => void;
}) {
  const now = new Date();
  return (
    <div className="receipt" role="status" aria-live="polite">
      <div className="receipt-header">
        <span className="receipt-check">✓</span>
        <h2>Venta registrada</h2>
        <p>{branchName}</p>
      </div>
      <dl className="receipt-details">
        <div>
          <dt>Total</dt>
          <dd>{formatMoneyCents(receipt.totalCents)}</dd>
        </div>
        <div>
          <dt>Pago</dt>
          <dd>{receipt.methodLabel}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>
            {now.toLocaleDateString("es-DO")} {now.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}
          </dd>
        </div>
        <div>
          <dt>Nº</dt>
          <dd>{receipt.saleId.slice(0, 8).toUpperCase()}</dd>
        </div>
      </dl>
      <p className="receipt-note">El recibo interno se sincroniza automáticamente cuando hay conexión.</p>
      <button type="button" className="receipt-new-sale" onClick={onNewSale}>
        Nueva venta
      </button>
      <button type="button" className="receipt-reverse" onClick={onReverse}>
        Anular venta
      </button>
    </div>
  );
}
