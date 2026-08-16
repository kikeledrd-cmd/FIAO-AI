import { z } from "zod";

export const CREDIT_MOVEMENT_TYPES = ["FIAO_SALE", "ABONO"] as const;
export type CreditMovementType = (typeof CREDIT_MOVEMENT_TYPES)[number];

/** Cliente de una sucursal con límite de crédito en centavos. */
export const customerSchema = z.object({
  customerId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  name: z.string().min(1).max(120),
  phoneE164: z.string().min(4).max(16).nullable().optional(),
  creditLimitCents: z.number().int().nonnegative(),
  defaultPromiseDays: z.number().int().min(0).max(365).default(7),
  active: z.boolean().default(true)
});
export type Customer = z.infer<typeof customerSchema>;

/** Payload de la operación CUSTOMER_UPSERT (creación o actualización idempotente). */
export const customerUpsertPayloadSchema = customerSchema;
export type CustomerUpsertPayload = z.infer<typeof customerUpsertPayloadSchema>;

/** Abono a la cuenta de un cliente. */
export const abonoPayloadSchema = z.object({
  abonoId: z.uuid(),
  customerId: z.uuid(),
  amountCents: z.number().int().positive(),
  note: z.string().max(200).optional(),
  /** Fecha prometida original del fiado que se abona (para el score). */
  promisedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))).nullable().optional(),
  occurredAt: z.string().refine((value) => Number.isFinite(Date.parse(value))).optional()
});
export type AbonoPayload = z.infer<typeof abonoPayloadSchema>;

/** Movimiento de crédito append-only replicado a los clientes. */
export const creditMovementChangeSchema = z.object({
  movementId: z.uuid(),
  type: z.enum(CREDIT_MOVEMENT_TYPES),
  customerId: z.uuid(),
  amountCents: z.number().int().positive(),
  saleId: z.uuid().nullable().optional(),
  abonoId: z.uuid().nullable().optional(),
  occurredAt: z.string()
});
export type CreditMovementChange = z.infer<typeof creditMovementChangeSchema>;
