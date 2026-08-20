import { databaseClient, type FiaoPrismaClient } from "../client";

export interface PilotSummary {
  generatedAt: string;
  /** Métricas §25 medibles server-side desde los ledgers + PilotEvent. */
  firstSaleAt: string | null;
  salesCount: number;
  salesToday: number;
  fiadoRecordedCents: number;
  collectionsCents: number;
  stockAdjustmentCount: number;
  cashCloseDifferenceCount: number;
  whatsappOrdersCount: number;
  whatsappAutoAcceptedCount: number;
  whatsappExceptionCount: number;
  aiQueryCount: number;
  aiActionCount: number;
  syncConflictCount: number;
  loginCount7d: number;
  activeDays7: number;
  activeDays30: number;
  onboardingCompletedCount: number;
  onboardingTotal: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** Instrumentación append-only del piloto + agregación de métricas §25. */
export class AnalyticsRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async record(input: { ownerId: string; branchId: string | null; eventName: string; metadata?: unknown; occurredAt?: Date }): Promise<void> {
    await this.db.pilotEvent.create({
      data: {
        ownerId: input.ownerId,
        branchId: input.branchId,
        eventName: input.eventName,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata as never }),
        occurredAt: input.occurredAt ?? new Date()
      }
    });
  }

  async summary(ownerId: string): Promise<PilotSummary> {
    const now = new Date();
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      firstSale,
      salesRecent,
      salesToday,
      fiaoMovements,
      stockAdjustments,
      cashCloseDiffs,
      whatsappOrders,
      aiLogs,
      syncConflicts,
      logins7d,
      onboardingStates
    ] = await Promise.all([
      this.db.sale.findFirst({ where: { ownerId }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
      this.db.sale.findMany({ where: { ownerId, occurredAt: { gte: since30 } }, select: { occurredAt: true } }),
      this.db.sale.count({ where: { ownerId, occurredAt: { gte: today } } }),
      this.db.creditMovement.findMany({ where: { ownerId, occurredAt: { gte: since30 } }, select: { type: true, amountCents: true, occurredAt: true } }),
      this.db.stockMovement.count({ where: { ownerId, type: "ADJUSTMENT" } }),
      this.db.cashSession.count({ where: { ownerId, differenceCents: { not: 0 } } }),
      this.db.order.findMany({ where: { ownerId, source: "WHATSAPP" }, select: { status: true, exceptionReason: true } }),
      this.db.aiAuditLog.findMany({ where: { ownerId, createdAt: { gte: since30 } }, select: { intentKind: true } }),
      this.db.syncConflict.count({ where: { ownerId } }),
      this.db.pilotEvent.count({ where: { ownerId, eventName: "USER_LOGIN", occurredAt: { gte: since7 } } }),
      this.db.onboardingState.findMany({ where: { ownerId }, select: { milestones: true } })
    ]);

    let fiadoRecordedCents = 0;
    let collectionsCents = 0;
    const activeDays = new Set<string>();
    for (const movement of fiaoMovements) {
      if (movement.type === "FIAO_SALE") fiadoRecordedCents += movement.amountCents;
      else if (movement.type === "ABONO") collectionsCents += movement.amountCents;
      activeDays.add(movement.occurredAt.toISOString().slice(0, 10));
    }
    for (const sale of salesRecent) activeDays.add(sale.occurredAt.toISOString().slice(0, 10));

    const daysSince = (date: Date): number => Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
    const activeDays7 = [...activeDays].filter((day) => daysSince(new Date(day)) < 7).length;
    const activeDays30 = [...activeDays].filter((day) => daysSince(new Date(day)) < 30).length;

    const whatsappAutoAcceptedCount = whatsappOrders.filter((order) => order.status !== "NEW").length;
    const whatsappExceptionCount = whatsappOrders.filter((order) => order.exceptionReason !== null).length;

    let aiQueryCount = 0;
    let aiActionCount = 0;
    for (const log of aiLogs) {
      if (log.intentKind === "QUERY") aiQueryCount += 1;
      else if (log.intentKind === "ACTION") aiActionCount += 1;
    }

    let onboardingCompletedCount = 0;
    let onboardingTotal = 0;
    for (const state of onboardingStates) {
      const milestones = (state.milestones as string[] | null) ?? [];
      onboardingTotal = Math.max(onboardingTotal, milestones.length);
      if (milestones.length >= 5) onboardingCompletedCount += 1;
    }

    return {
      generatedAt: now.toISOString(),
      firstSaleAt: firstSale?.occurredAt.toISOString() ?? null,
      salesCount: salesRecent.length,
      salesToday,
      fiadoRecordedCents,
      collectionsCents,
      stockAdjustmentCount: stockAdjustments,
      cashCloseDifferenceCount: cashCloseDiffs,
      whatsappOrdersCount: whatsappOrders.length,
      whatsappAutoAcceptedCount,
      whatsappExceptionCount,
      aiQueryCount,
      aiActionCount,
      syncConflictCount: syncConflicts,
      loginCount7d: logins7d,
      activeDays7,
      activeDays30,
      onboardingCompletedCount,
      onboardingTotal
    };
  }
}
