import { z } from "zod";

/** Promoción determinística (spec §8 y roadmap: deterministic promotions). */
export const promotionSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  name: z.string().min(1).max(80),
  kind: z.enum(["PERCENT_OFF", "FIXED_OFF", "BUNDLE_BUY_X_GET_Y"]),
  scope: z.enum(["PRODUCT", "TOTAL"]),
  productId: z.uuid().nullable(),
  percentOffCents: z.number().int().nonnegative().nullable(),
  fixedOffCents: z.number().int().nonnegative().nullable(),
  buyQty: z.number().int().positive().nullable(),
  getQty: z.number().int().positive().nullable(),
  active: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type Promotion = z.infer<typeof promotionSchema>;
