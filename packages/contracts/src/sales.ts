import { z } from "zod";

export const SALE_PAYMENT_METHODS = ["CASH", "TRANSFER", "CARD"] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

/** Cantidad decimal fija (hasta 3 decimales), p. ej. "1", "0.5", "2.250". */
export const saleQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, "INVALID_QUANTITY");

export const saleLineSchema = z.object({
  productId: z.uuid(),
  quantity: saleQuantitySchema,
  priceCents: z.number().int().positive()
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  method: z.enum(SALE_PAYMENT_METHODS),
  amountCents: z.number().int().positive()
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleOperationPayloadSchema = z.object({
  saleId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(saleLineSchema).min(1).max(50),
  payments: z.array(salePaymentSchema).min(1).max(SALE_PAYMENT_METHODS.length)
});
export type SaleOperationPayload = z.infer<typeof saleOperationPayloadSchema>;

/** Resultado calculado por el dominio, persistido y replicado. */
export interface SaleTotals {
  subtotalCents: number;
  totalCents: number;
}

export interface CatalogProduct {
  id: string;
  ownerId: string;
  branchId: string;
  name: string;
  barcode: string | null;
  priceCents: number;
  stockControl: boolean;
  unitLabel: string;
  onHand: string | null;
  active: boolean;
}

export interface StockMovementRecord {
  id: string;
  ownerId: string;
  branchId: string;
  productId: string;
  type: string;
  quantityDelta: string;
  clientOperationId: string;
  createdAt: string;
}
