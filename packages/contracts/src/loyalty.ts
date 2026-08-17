import { z } from "zod";

/** Config de lealtad por owner (spec §8): regla de ganancia y vencimiento. */
export const loyaltyConfigSchema = z.object({
  enabled: z.boolean(),
  pointsPerHundredCents: z.number().int().positive(),
  expiryDays: z.number().int().positive()
});
export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;

/** Movimiento del ledger de puntos (append-only; el saldo es computado). */
export const loyaltyMovementSchema = z.object({
  movementId: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  customerId: z.uuid(),
  type: z.enum(["EARN", "REDEEM", "EXPIRE", "REVERSAL"]),
  pointsDelta: z.number().int(),
  saleId: z.uuid().nullable(),
  rewardId: z.uuid().nullable(),
  reason: z.string().max(300).nullable(),
  expiresAt: z.string().datetime().nullable(),
  occurredAt: z.string().datetime()
});
export type LoyaltyMovement = z.infer<typeof loyaltyMovementSchema>;

/** Recompensa canjeable por puntos (spec §8: free product / fixed discount). */
export const loyaltyRewardSchema = z.object({
  rewardId: z.uuid(),
  ownerId: z.uuid(),
  name: z.string().min(1).max(80),
  kind: z.enum(["FREE_PRODUCT", "FIXED_DISCOUNT"]),
  productId: z.uuid().nullable(),
  discountCents: z.number().int().nonnegative().nullable(),
  pointsCost: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.string().datetime()
});
export type LoyaltyReward = z.infer<typeof loyaltyRewardSchema>;

/** Referencia de redención incluida en el payload de venta. */
export const loyaltyRedemptionSchema = z.object({
  rewardId: z.uuid(),
  pointsCost: z.number().int().positive()
});
export type LoyaltyRedemption = z.infer<typeof loyaltyRedemptionSchema>;
