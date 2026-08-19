import { z } from "zod";

/** Configuración operativa por sucursal (reglas de operación V1). */
export const businessSettingsSchema = z.object({
  branchId: z.uuid(),
  defaultPromiseDays: z.number().int().min(0).max(365),
  lowStockThreshold: z.number().int().min(0).max(10000),
  cashierDiscountLimitCents: z.number().int().min(0),
  whatsappRemindersEnabled: z.boolean()
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

export const settingsUpdateSchema = businessSettingsSchema.omit({ branchId: true }).partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const ONBOARDING_MILESTONES = [
  "BRANCH_CREATED",
  "CATALOG_LOADED",
  "CUSTOMER_CREATED",
  "CASH_OPENED",
  "FIRST_SALE"
] as const;
export type OnboardingMilestone = (typeof ONBOARDING_MILESTONES)[number];

export const onboardingStateSchema = z.object({
  branchId: z.uuid(),
  completed: z.array(z.enum(ONBOARDING_MILESTONES)),
  next: z.enum(ONBOARDING_MILESTONES).nullable(),
  total: z.number().int(),
  completedCount: z.number().int()
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
});
export type DeviceRecord = z.infer<typeof deviceSchema>;

export const deviceRevokeRequestSchema = z.object({
  branchId: z.uuid(),
  deviceId: z.uuid()
});
export type DeviceRevokeRequest = z.infer<typeof deviceRevokeRequestSchema>;
