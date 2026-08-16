import { z } from "zod";

/** Delta de stock con signo, decimal fijo hasta 3 decimales ("5", "-2", "0.5"). */
export const adjustmentDeltaSchema = z
  .string()
  .regex(/^[+-]?\d+(\.\d{1,3})?$/, "INVALID_ADJUSTMENT_DELTA");

/** Ajuste manual de stock (compra, merma, corrección). */
export const stockAdjustmentPayloadSchema = z.object({
  adjustmentId: z.uuid(),
  productId: z.uuid(),
  quantityDelta: adjustmentDeltaSchema,
  reason: z.string().min(1).max(200),
  ownerAuthorizationId: z.uuid().nullable().optional()
});
export type StockAdjustmentPayload = z.infer<typeof stockAdjustmentPayloadSchema>;

/** Reverso (anulación) de una venta. */
export const saleReversalPayloadSchema = z.object({
  reversalId: z.uuid(),
  saleId: z.uuid(),
  reason: z.string().min(1).max(200),
  ownerAuthorizationId: z.uuid().nullable().optional()
});
export type SaleReversalPayload = z.infer<typeof saleReversalPayloadSchema>;

/** Solicitud al endpoint de autorización de OWNER. */
export const ownerAuthorizeRequestSchema = z.object({
  branchId: z.uuid(),
  purpose: z.enum(["STOCK_ADJUSTMENT", "SALE_REVERSAL"]),
  targetOperationId: z.uuid(),
  pin: z.string().min(1).max(32)
});
export type OwnerAuthorizeRequest = z.infer<typeof ownerAuthorizeRequestSchema>;

export const OWNER_AUTHORIZE_PURPOSES = ["STOCK_ADJUSTMENT", "SALE_REVERSAL"] as const;
export type OwnerAuthorizePurpose = (typeof OWNER_AUTHORIZE_PURPOSES)[number];
