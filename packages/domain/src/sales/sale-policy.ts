import type { SaleLine, SalePayment } from "@fiao/contracts/sales";

export interface SalePolicyResult {
  subtotalCents: number;
  totalCents: number;
}

export interface SaleLineTotal {
  productId: string;
  quantity: string;
  priceCents: number;
  totalCents: number;
}

export const SALE_QUANTITY_SCALE = 1_000; // 3 decimales

export function parseSaleQuantity(value: string): { scaled: bigint; scale: number } {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) throw new Error("INVALID_QUANTITY");
  const [whole = "0", fraction = ""] = value.split(".");
  const scale = fraction.length;
  const scaled =
    BigInt(whole) * BigInt(SALE_QUANTITY_SCALE) + BigInt(fraction.padEnd(3, "0"));
  if (scaled <= 0n) throw new Error("INVALID_QUANTITY");
  return { scaled, scale };
}

/** Total en centavos de una línea, con aritmética entera (sin floats). */
export function saleLineTotalCents(priceCents: number, quantity: string): number {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new Error("INVALID_PRICE");
  const { scaled } = parseSaleQuantity(quantity);
  // priceCents * (scaled/1000), redondeado al centavo más cercano.
  const product = BigInt(priceCents) * scaled;
  const total = product / BigInt(SALE_QUANTITY_SCALE);
  const remainder = product % BigInt(SALE_QUANTITY_SCALE);
  const rounded = remainder * 2n >= BigInt(SALE_QUANTITY_SCALE) ? total + 1n : total;
  if (rounded <= 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("INVALID_LINE_TOTAL");
  return Number(rounded);
}

export function computeLineTotals(lines: SaleLine[]): SaleLineTotal[] {
  if (lines.length === 0) throw new Error("EMPTY_LINES");
  return lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    priceCents: line.priceCents,
    totalCents: saleLineTotalCents(line.priceCents, line.quantity)
  }));
}

export function subtotalCents(lines: SaleLine[]): number {
  return computeLineTotals(lines).reduce((sum, line) => sum + line.totalCents, 0);
}

export function paymentTotalCents(payments: SalePayment[]): number {
  if (payments.length === 0) throw new Error("EMPTY_PAYMENTS");
  const methods = new Set<string>();
  for (const payment of payments) {
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      throw new Error("INVALID_PAYMENT");
    }
    if (methods.has(payment.method)) throw new Error("DUPLICATE_PAYMENT_METHOD");
    methods.add(payment.method);
  }
  return payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

/** Resta cantidades decimales fijas y devuelve el resultado normalizado. */
export function subtractDecimalQuantities(minuend: string, subtrahend: string): string {
  const a = parseSaleQuantity(minuend).scaled;
  const b = parseSaleQuantity(subtrahend).scaled;
  return formatScaled(a - b);
}

/** Suma cantidades decimales fijas y devuelve el resultado normalizado. */
export function addDecimalQuantities(left: string, right: string): string {
  const a = parseSaleQuantity(left).scaled;
  const b = parseSaleQuantity(right).scaled;
  return formatScaled(a + b);
}

function formatScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / BigInt(SALE_QUANTITY_SCALE);
  const fraction = (absolute % BigInt(SALE_QUANTITY_SCALE)).toString().padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export interface SalePolicyOptions {
  /** Descuento total aplicado (promos + redención de lealtad), centavos. */
  discountCents?: number;
}

/**
 * Valida el payload de una venta y devuelve los totales calculados.
 * Reglas: líneas no vacías; pagos no vacíos, sin métodos duplicados;
 * el total de pagos debe cuadrar EXACTO con el total (subtotal − descuento).
 */
export function validateSale(
  lines: SaleLine[],
  payments: SalePayment[],
  options: SalePolicyOptions = {}
): SalePolicyResult {
  const subtotal = subtotalCents(lines);
  const discount = options.discountCents ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0) throw new Error("INVALID_DISCOUNT");
  if (discount > subtotal) throw new Error("DISCOUNT_EXCEEDS_TOTAL");
  const total = subtotal - discount;
  const paid = paymentTotalCents(payments);
  if (paid !== total) throw new Error("PAYMENT_TOTAL_MISMATCH");
  for (const payment of payments) {
    if (payment.amountCents > total) throw new Error("PAYMENT_EXCEEDS_TOTAL");
  }
  return { subtotalCents: subtotal, totalCents: total };
}
