export type OrderStatus =
  | "NEW"
  | "PREPARING"
  | "READY"
  | "ON_THE_WAY"
  | "DELIVERED"
  | "CANCELLED";

export type OrderSource = "WHATSAPP" | "MANUAL" | "REPEAT";

/** Transiciones válidas de estado (append-only). */
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["ON_THE_WAY", "CANCELLED"],
  ON_THE_WAY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: []
};

/**
 * Valida una transición de estado de pedido (append-only). Los estados solo
 * avanzan en el flujo New → Preparing → Ready → On the way → Delivered, con
 * cancelación permitida en cualquier punto salvo terminales.
 */
export function assertOrderTransitionValid(current: OrderStatus, next: OrderStatus): void {
  if (!ORDER_TRANSITIONS[current].includes(next)) {
    throw new Error("INVALID_ORDER_TRANSITION");
  }
}

/** La cancelación antes de `PREPARING` (estado NEW) no requiere autorización. */
export function orderCancelRequiresAuthorization(current: OrderStatus): boolean {
  return current !== "NEW";
}

/** La reserva de inventario ocurre al aceptar un pedido (NEW → PREPARING). */
export function reservesStockOnTransition(next: OrderStatus): boolean {
  return next === "PREPARING";
}

/** La entrega (ON_THE_WAY → DELIVERED) finaliza la venta. */
export function finalizesSaleOnTransition(next: OrderStatus): boolean {
  return next === "DELIVERED";
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: "Nuevo",
  PREPARING: "Preparando",
  READY: "Listo",
  ON_THE_WAY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado"
};
