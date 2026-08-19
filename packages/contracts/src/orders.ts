import { z } from "zod";
import { salePaymentSchema } from "./sales";

export const ORDER_STATUSES = ["NEW", "PREPARING", "READY", "ON_THE_WAY", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["WHATSAPP", "MANUAL", "REPEAT"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Línea de pedido (mismo shape que una línea de venta). */
export const orderLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "INVALID_QUANTITY"),
  priceCents: z.number().int().positive()
});
export type OrderLineInput = z.infer<typeof orderLineSchema>;

/** Creación de pedido (manual o desde webhook normalizado). */
export const orderCreatePayloadSchema = z.object({
  orderId: z.uuid(),
  branchId: z.uuid(),
  source: z.enum(ORDER_SOURCES),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(orderLineSchema).min(1).max(50),
  deliveryName: z.string().max(80).nullable().optional(),
  deliveryAddress: z.string().max(300).nullable().optional(),
  deliveryFeeCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(300).nullable().optional(),
  occurredAt: z.string().datetime()
});
export type OrderCreatePayload = z.infer<typeof orderCreatePayloadSchema>;

/** Aceptar un pedido (NEW → PREPARING): reserva inventario. */
export const orderAcceptPayloadSchema = z.object({
  orderId: z.uuid(),
  branchId: z.uuid(),
  occurredAt: z.string().datetime()
});
export type OrderAcceptPayload = z.infer<typeof orderAcceptPayloadSchema>;

/** Avanzar estado (PREPARING → READY → ON_THE_WAY). */
export const orderAdvancePayloadSchema = z.object({
  orderId: z.uuid(),
  branchId: z.uuid(),
  nextStatus: z.enum(["READY", "ON_THE_WAY"]),
  deliveryName: z.string().max(80).nullable().optional(),
  occurredAt: z.string().datetime()
});
export type OrderAdvancePayload = z.infer<typeof orderAdvancePayloadSchema>;

/** Cancelar un pedido (libera reserva si ya se aceptó). */
export const orderCancelPayloadSchema = z.object({
  orderId: z.uuid(),
  branchId: z.uuid(),
  reason: z.string().min(1).max(300),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type OrderCancelPayload = z.infer<typeof orderCancelPayloadSchema>;

/** Entregar (ON_THE_WAY → DELIVERED): finaliza venta/pago/lealtad. */
export const orderDeliverPayloadSchema = z.object({
  orderId: z.uuid(),
  branchId: z.uuid(),
  payments: z.array(salePaymentSchema).min(1),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type OrderDeliverPayload = z.infer<typeof orderDeliverPayloadSchema>;

/** Evento de línea de tiempo (append-only). */
export const orderTimelineEventSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  at: z.string().datetime(),
  actorUserId: z.uuid().nullable(),
  note: z.string().max(300).nullable()
});
export type OrderTimelineEvent = z.infer<typeof orderTimelineEventSchema>;

/** Pedido para API/UI. */
export const orderSchema = z.object({
  orderId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  source: z.enum(ORDER_SOURCES),
  status: z.enum(ORDER_STATUSES),
  customerId: z.uuid().nullable(),
  lines: z.array(
    z.object({
      productId: z.uuid(),
      quantity: z.string(),
      priceCents: z.number().int(),
      lineTotalCents: z.number().int()
    })
  ),
  deliveryName: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  deliveryFeeCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  exceptionReason: z.string().nullable(),
  saleId: z.uuid().nullable(),
  createdAt: z.string().datetime(),
  timeline: z.array(orderTimelineEventSchema)
});
export type Order = z.infer<typeof orderSchema>;
