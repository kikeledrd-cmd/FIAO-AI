import { parseSaleQuantity } from "@fiao/domain/sales/sale-policy";

export interface PurchaseLineInput {
  productId: string;
  quantity: string;
  unitCostCents: number;
}

/**
 * Costo promedio móvil determinístico (aritmética entera).
 *
 * newCost = round((oldCost·oldQty + unitCost·qty) / (oldQty + qty))
 *
 * - cantidades en milésimas (scaled de parseSaleQuantity)
 * - costos en centavos
 * - redondeo fijo: half away from zero (Math.round)
 * - sin stock previo (oldQty 0) o costo desconocido (oldCost 0, p.ej. stock
 *   sembrado) → el costo de la compra fija el costo
 */
export function computeMovingAverageCost(
  oldCostCents: number,
  oldOnHand: string,
  unitCostCents: number,
  quantity: string
): number {
  if (!Number.isInteger(oldCostCents) || oldCostCents < 0) throw new Error("INVALID_COST");
  if (!Number.isInteger(unitCostCents) || unitCostCents <= 0) throw new Error("INVALID_COST");

  const oldQty = parseScaledQuantity(oldOnHand, "INVALID_QUANTITY");
  const qty = parseScaledQuantity(quantity, "INVALID_QUANTITY");
  if (qty <= 0n) throw new Error("INVALID_QUANTITY");

  if (oldQty === 0n || oldCostCents === 0) return unitCostCents;

  const totalScaled = BigInt(oldCostCents) * oldQty + BigInt(unitCostCents) * qty; // centavos·milésimas
  const totalQtyScaled = oldQty + qty;
  return Number(roundHalfAwayFromZero(totalScaled, totalQtyScaled));
}

function parseScaledQuantity(value: string, errorCode: string): bigint {
  if (/^0+(\.0+)?$/.test(value)) return 0n;
  let scaled: bigint;
  try {
    scaled = parseSaleQuantity(value).scaled;
  } catch {
    throw new Error(errorCode);
  }
  if (scaled < 0n) throw new Error(errorCode);
  return scaled;
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -roundHalfAwayFromZero(-numerator, denominator);
  // floor((n + d/2) / d) con d > 0
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function assertPurchaseLineValid(
  line: PurchaseLineInput,
  stockControl: boolean
): void {
  if (!Number.isInteger(line.unitCostCents) || line.unitCostCents <= 0) {
    throw new Error("INVALID_UNIT_COST");
  }
  const quantity = parseScaledQuantity(line.quantity, "INVALID_QUANTITY");
  if (quantity <= 0n) throw new Error("INVALID_QUANTITY");
  if (!stockControl) throw new Error("STOCK_CONTROL_REQUIRED");
}
