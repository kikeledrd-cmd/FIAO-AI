import { z } from "zod";

/** Línea de apartado (contrato compartido con venta). */
export const apartadoLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "INVALID_QUANTITY"),
  priceCents: z.number().int().positive()
});
export type ApartadoLine = z.infer<typeof apartadoLineSchema>;

/** Creación de apartado: reserva inventario y registra el anticipo en caja. */
export const apartadoCreatePayloadSchema = z.object({
  apartadoId: z.uuid(),
  branchId: z.uuid(),
  customerId: z.uuid(),
  lines: z.array(apartadoLineSchema).min(1),
  depositCents: z.number().int().nonnegative(),
  totalCents: z.number().int().positive(),
  promiseDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  actorUserId: z.uuid(),
  occurredAt: z.string().datetime()
});
export type ApartadoCreatePayload = z.infer<typeof apartadoCreatePayloadSchema>;

/** Completar apartado: libera la reserva y crea la venta real. */
export const apartadoCompletePayloadSchema = z.object({
  apartadoId: z.uuid(),
  branchId: z.uuid(),
  /** Método y monto del resto (el anticipo se paga con APARTADO_CREDIT). */
  remainderPayments: z
    .array(
      z.object({
        method: z.enum(["CASH", "TRANSFER", "CARD"]),
        amountCents: z.number().int().positive()
      })
    )
    .min(1),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type ApartadoCompletePayload = z.infer<typeof apartadoCompletePayloadSchema>;

/** Cancelar apartado: libera reserva y devuelve el anticipo como crédito a favor. */
export const apartadoCancelPayloadSchema = z.object({
  apartadoId: z.uuid(),
  branchId: z.uuid(),
  reason: z.string().min(1).max(300),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type ApartadoCancelPayload = z.infer<typeof apartadoCancelPayloadSchema>;

/** Apartado para API/UI. */
export const apartadoSchema = z.object({
  apartadoId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  customerId: z.uuid(),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
  lines: z.array(
    z.object({
      productId: z.uuid(),
      quantity: z.string(),
      priceCents: z.number().int(),
      lineTotalCents: z.number().int()
    })
  ),
  depositCents: z.number().int().nonnegative(),
  totalCents: z.number().int().positive(),
  promiseDate: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  actorUserId: z.uuid(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type Apartado = z.infer<typeof apartadoSchema>;
