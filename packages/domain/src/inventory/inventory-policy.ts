import { addDecimalQuantities, parseSaleQuantity, subtractDecimalQuantities } from "@fiao/domain/sales/sale-policy";

/**
 * Normaliza un delta de ajuste con signo a la forma canónica ("+3" -> "3",
 * "-1.250" -> "-1.25"). Rechaza cero y formatos inválidos.
 */
export function parseAdjustmentDelta(value: string): string {
  if (!/^[+-]?\d+(\.\d{1,3})?$/.test(value)) throw new Error("INVALID_ADJUSTMENT_DELTA");
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const negative = normalized.startsWith("-");
  const magnitude = negative ? normalized.slice(1) : normalized;
  // El cero (con o sin signo) no es un ajuste válido.
  if (/^0+(\.0+)?$/.test(magnitude)) throw new Error("INVALID_ADJUSTMENT_DELTA");
  const parsed = parseSaleQuantity(magnitude);
  const whole = parsed.scaled / 1000n;
  const fraction = (parsed.scaled % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  const result = `${whole}${fraction ? `.${fraction}` : ""}`;
  return negative ? `-${result}` : result;
}

/**
 * Aplica un delta con signo al onHand actual y devuelve el nuevo onHand.
 * Nunca permite que el stock quede negativo.
 */
export function applyStockDelta(onHand: string | null, delta: string): string {
  if (onHand === null) throw new Error("STOCK_CONTROL_REQUIRED");
  const normalized = parseAdjustmentDelta(delta);
  if (normalized.startsWith("-")) {
    const amount = normalized.slice(1);
    if (Number(amount) > Number(onHand)) throw new Error("STOCK_NEGATIVE");
    return isZeroQuantity(onHand) ? "0" : subtractDecimalQuantities(onHand, amount);
  }
  return isZeroQuantity(onHand) ? normalized : addDecimalQuantities(onHand, normalized);
}

function isZeroQuantity(value: string): boolean {
  return /^0+(\.0+)?$/.test(value);
}
