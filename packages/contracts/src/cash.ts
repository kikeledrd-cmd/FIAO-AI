import { z } from "zod";

/** Apertura de caja: float inicial, responsable y dispositivo (spec §10.1). */
export const cashOpenPayloadSchema = z.object({
  sessionId: z.uuid(),
  branchId: z.uuid(),
  openingFloatCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime()
});
export type CashOpenPayload = z.infer<typeof cashOpenPayloadSchema>;

/** Gasto de caja (spec §10.3): monto, categoría, descripción, método. */
export const cashExpensePayloadSchema = z.object({
  movementId: z.uuid(),
  sessionId: z.uuid(),
  amountCents: z.number().int().positive(),
  category: z.string().min(1).max(60),
  description: z.string().max(300).nullable().optional(),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type CashExpensePayload = z.infer<typeof cashExpensePayloadSchema>;

/** Retiro de caja (spec §10.4): no es gasto operativo; siempre autorizado. */
export const cashWithdrawalPayloadSchema = z.object({
  movementId: z.uuid(),
  sessionId: z.uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).max(300),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type CashWithdrawalPayload = z.infer<typeof cashWithdrawalPayloadSchema>;

/** Inyección extraordinaria de efectivo (spec §10.2); siempre autorizada. */
export const cashInjectionPayloadSchema = z.object({
  movementId: z.uuid(),
  sessionId: z.uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).max(300),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type CashInjectionPayload = z.infer<typeof cashInjectionPayloadSchema>;

/** Cierre/arqueo (spec §10.5): efectivo contado; la diferencia la computa FIAO. */
export const cashClosePayloadSchema = z.object({
  sessionId: z.uuid(),
  countedCents: z.number().int().nonnegative(),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type CashClosePayload = z.infer<typeof cashClosePayloadSchema>;

/** Sesión de caja (para API/UI). */
export const cashSessionSchema = z.object({
  sessionId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  status: z.enum(["OPEN", "CLOSED"]),
  openedById: z.uuid(),
  openedAt: z.string().datetime(),
  openingFloatCents: z.number().int().nonnegative(),
  closedById: z.uuid().nullable(),
  closedAt: z.string().datetime().nullable(),
  countedCents: z.number().int().nonnegative().nullable(),
  differenceCents: z.number().int().nullable()
});
export type CashSession = z.infer<typeof cashSessionSchema>;

/** Movimiento de caja (append-only). */
export const cashMovementSchema = z.object({
  movementId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  sessionId: z.uuid(),
  type: z.enum(["EXPENSE", "WITHDRAWAL", "INJECTION", "DIFFERENCE"]),
  amountCents: z.number().int(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  reason: z.string().nullable(),
  actorUserId: z.uuid(),
  occurredAt: z.string().datetime()
});
export type CashMovement = z.infer<typeof cashMovementSchema>;
