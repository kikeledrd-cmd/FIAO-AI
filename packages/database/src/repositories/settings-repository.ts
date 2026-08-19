import type { BusinessSettings, DeviceRecord, OnboardingMilestone, OnboardingState, SettingsUpdate } from "@fiao/contracts/settings";
import { databaseClient, type FiaoPrismaClient } from "../client";

function mapSettings(row: {
  branchId: string;
  defaultPromiseDays: number;
  lowStockThreshold: number;
  cashierDiscountLimitCents: number;
  whatsappRemindersEnabled: boolean;
}): BusinessSettings {
  return {
    branchId: row.branchId,
    defaultPromiseDays: row.defaultPromiseDays,
    lowStockThreshold: row.lowStockThreshold,
    cashierDiscountLimitCents: row.cashierDiscountLimitCents,
    whatsappRemindersEnabled: row.whatsappRemindersEnabled
  };
}

const SETTINGS_DEFAULTS = {
  defaultPromiseDays: 7,
  lowStockThreshold: 3,
  cashierDiscountLimitCents: 1000,
  whatsappRemindersEnabled: false
} as const;

/** Configuración operativa por sucursal (upsert singleton). */
export class SettingsRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async getByBranch(ownerId: string, branchId: string): Promise<BusinessSettings> {
    const row = await this.db.businessSettings.findUnique({ where: { branchId } });
    if (!row) {
      const created = await this.db.businessSettings.create({
        data: { ownerId, branchId, ...SETTINGS_DEFAULTS }
      });
      return mapSettings(created);
    }
    return mapSettings(row);
  }

  async update(ownerId: string, branchId: string, update: SettingsUpdate): Promise<BusinessSettings> {
    const data = {
      ...(update.defaultPromiseDays !== undefined ? { defaultPromiseDays: update.defaultPromiseDays } : {}),
      ...(update.lowStockThreshold !== undefined ? { lowStockThreshold: update.lowStockThreshold } : {}),
      ...(update.cashierDiscountLimitCents !== undefined ? { cashierDiscountLimitCents: update.cashierDiscountLimitCents } : {}),
      ...(update.whatsappRemindersEnabled !== undefined ? { whatsappRemindersEnabled: update.whatsappRemindersEnabled } : {})
    };
    const row = await this.db.businessSettings.upsert({
      where: { branchId },
      update: data,
      create: { ownerId, branchId, ...SETTINGS_DEFAULTS, ...data }
    });
    return mapSettings(row);
  }
}

const MILESTONE_ORDER: OnboardingMilestone[] = [
  "BRANCH_CREATED",
  "CATALOG_LOADED",
  "CUSTOMER_CREATED",
  "CASH_OPENED",
  "FIRST_SALE"
];

/** Estado de onboarding computado dinámicamente desde los ledgers (reconciliado). */
export class OnboardingRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async getState(ownerId: string, branchId: string): Promise<OnboardingState> {
    const [catalogCount, customerCount, cashSessionCount, saleCount] = await Promise.all([
      this.db.product.count({ where: { ownerId, branchId, active: true } }),
      this.db.customer.count({ where: { ownerId, branchId } }),
      this.db.cashSession.count({ where: { ownerId, branchId } }),
      this.db.sale.count({ where: { ownerId, branchId } })
    ]);

    const completed: OnboardingMilestone[] = ["BRANCH_CREATED"];
    if (catalogCount > 0) completed.push("CATALOG_LOADED");
    if (customerCount > 0) completed.push("CUSTOMER_CREATED");
    if (cashSessionCount > 0) completed.push("CASH_OPENED");
    if (saleCount > 0) completed.push("FIRST_SALE");

    const next = MILESTONE_ORDER.find((milestone) => !completed.includes(milestone)) ?? null;

    // Persiste el snapshot para el tracking de activación.
    await this.db.onboardingState.upsert({
      where: { branchId },
      update: { ownerId, milestones: completed },
      create: { ownerId, branchId, milestones: completed }
    });

    return {
      branchId,
      completed,
      next,
      total: MILESTONE_ORDER.length,
      completedCount: completed.length
    };
  }
}

/** Gestión de dispositivos: listar y revocar (invalida sesiones del dispositivo). */
export class DeviceRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listByOwner(ownerId: string): Promise<DeviceRecord[]> {
    const rows = await this.db.device.findMany({
      where: { ownerId },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, label: true, active: true, createdAt: true, lastSeenAt: true }
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString()
    }));
  }

  async revoke(ownerId: string, deviceId: string): Promise<boolean> {
    const device = await this.db.device.findFirst({ where: { id: deviceId, ownerId }, select: { id: true } });
    if (!device) return false;
    await this.db.$transaction([
      this.db.device.update({ where: { id: deviceId }, data: { active: false } }),
      this.db.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    return true;
  }
}
