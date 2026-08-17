import {
  addDecimalQuantities,
  parseSaleQuantity,
  subtractDecimalQuantities
} from "../sales/sale-policy";

export type ApartadoStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface ApartadoLineInput {
  productId: string;
  quantity: string;
  priceCents: number;
}

export interface ApartadoStockLine extends ApartadoLineInput {
  /** Stock físico (onHand) del producto en la sucursal. */
  onHand: string;
  /** Stock reservado del producto en la sucursal. */
  reserved: string;
}

export interface ApartadoCreateInput {
  lines: ApartadoStockLine[];
  depositCents: number;
  totalCents: number;
}

/**
 * Cantidad disponible = onHand − reserved. Nunca negativa.
 */
export function availableQuantity(onHand: string, reserved: string): string {
  const reservedNorm = reserved === "" ? "0" : reserved;
  if (reservedNorm === "0") return onHand === "" ? "0" : onHand;
  try {
    return subtractDecimalQuantities(onHand === "" ? "0" : onHand, reservedNorm);
  } catch {
    return "0";
  }
}

/** Parsea una cantidad a milésimas de forma segura ("0" → 0n). */
function safeScaled(value: string): bigint {
  if (value === "" || value === "0") return 0n;
  try {
    return parseSaleQuantity(value).scaled;
  } catch {
    return 0n;
  }
}

/**
 * Valida una línea de apartado: producto con control de stock debe tener
 * cantidad disponible suficiente; cantidad y precio deben ser positivos.
 */
export function assertApartadoLineValid(line: ApartadoStockLine): void {
  if (line.productId.length === 0) throw new Error("INVALID_PRODUCT");
  const { scaled } = parseSaleQuantity(line.quantity);
  if (scaled <= 0n) throw new Error("INVALID_QUANTITY");
  if (!Number.isSafeInteger(line.priceCents) || line.priceCents <= 0) {
    throw new Error("INVALID_PRICE");
  }
  const available = availableQuantity(line.onHand, line.reserved);
  if (safeScaled(available) < scaled) {
    throw new Error("INSUFFICIENT_STOCK");
  }
}

/**
 * Valida la creación de un apartado: líneas válidas, anticipo en [0, total].
 */
export function assertApartadoCreateValid(input: ApartadoCreateInput): void {
  if (input.lines.length === 0) throw new Error("EMPTY_LINES");
  for (const line of input.lines) assertApartadoLineValid(line);
  if (!Number.isSafeInteger(input.depositCents) || input.depositCents < 0) {
    throw new Error("INVALID_DEPOSIT");
  }
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error("INVALID_TOTAL");
  }
  if (input.depositCents > input.totalCents) {
    throw new Error("DEPOSIT_EXCEEDS_TOTAL");
  }
}

const APARTADO_TRANSITIONS: Record<ApartadoStatus, ApartadoStatus[]> = {
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: []
};

/**
 * Valida una transición de estado de apartado (append-only: ACTIVE solo
 * puede pasar a COMPLETED o CANCELLED).
 */
export function assertApartadoTransitionValid(
  current: ApartadoStatus,
  next: ApartadoStatus
): void {
  if (!APARTADO_TRANSITIONS[current].includes(next)) {
    throw new Error("INVALID_APARTADO_TRANSITION");
  }
}

/** Reserva una cantidad: reserved += qty (string decimal). */
export function addReservation(reserved: string, quantity: string): string {
  if (quantity === "" || quantity === "0") return reserved === "" ? "0" : reserved;
  if (reserved === "" || reserved === "0") return quantity;
  return addDecimalQuantities(reserved, quantity);
}

/** Libera una reserva: reserved −= qty, saturado en "0". */
export function releaseReservation(reserved: string, quantity: string): string {
  if (quantity === "" || quantity === "0") return reserved === "" ? "0" : reserved;
  if (reserved === "" || reserved === "0") return "0";
  try {
    const result = subtractDecimalQuantities(reserved, quantity);
    return result.startsWith("-") ? "0" : result;
  } catch {
    return "0";
  }
}
