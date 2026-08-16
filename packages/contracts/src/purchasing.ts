import { z } from "zod";

/** Alta/edición de proveedor (datos maestros, sin autorización de OWNER). */
export const supplierUpsertPayloadSchema = z.object({
  supplierId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  name: z.string().min(1).max(120),
  phoneE164: z.string().max(16).nullable().optional(),
  active: z.boolean().default(true)
});
export type SupplierUpsertPayload = z.infer<typeof supplierUpsertPayloadSchema>;

/** Línea de compra: cantidad decimal + costo unitario en centavos. */
export const purchaseLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "INVALID_QUANTITY"),
  unitCostCents: z.number().int().positive()
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

/** Compra a proveedor (append-only, actualiza stock y costo promedio móvil). */
export const purchasePayloadSchema = z.object({
  purchaseId: z.uuid(),
  supplierId: z.uuid().nullable().optional(),
  lines: z.array(purchaseLineSchema).min(1),
  note: z.string().max(300).nullable().optional(),
  ownerAuthorizationId: z.uuid().nullable().optional(),
  occurredAt: z.string().datetime()
});
export type PurchasePayload = z.infer<typeof purchasePayloadSchema>;

/** Proveedor con saldo de compras acumulado (para el listado). */
export const supplierWithStatsSchema = z.object({
  supplierId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  name: z.string(),
  phoneE164: z.string().nullable(),
  active: z.boolean(),
  purchaseCount: z.number().int().nonnegative(),
  totalPurchasedCents: z.number().int().nonnegative()
});
export type SupplierWithStats = z.infer<typeof supplierWithStatsSchema>;
