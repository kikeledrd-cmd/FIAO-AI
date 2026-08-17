import type { LoyaltyConfig, LoyaltyMovement, LoyaltyReward } from "@fiao/contracts/loyalty";
import type { Promotion } from "@fiao/contracts/promotions";
import { computeLoyaltyBalance, type LoyaltyMovementType } from "@fiao/domain/loyalty/loyalty-policy";
import { databaseClient, type FiaoPrismaClient } from "../client";

export interface CustomerLoyalty {
  customerId: string;
  /** Puntos no vencidos a la fecha actual (se computa, nunca se guarda). */
  balance: number;
  movements: LoyaltyMovement[];
}

const DEFAULT_CONFIG = { enabled: true, pointsPerHundredCents: 100, expiryDays: 180 } as const;

/** Lectura de lealtad: config, saldo/ledger por cliente, recompensas y promos. */
export class LoyaltyRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async getConfig(ownerId: string): Promise<LoyaltyConfig> {
    const config = await this.db.loyaltyConfig.findUnique({ where: { ownerId } });
    return config
      ? { enabled: config.enabled, pointsPerHundredCents: config.pointsPerHundredCents, expiryDays: config.expiryDays }
      : { ...DEFAULT_CONFIG };
  }

  async getCustomerLoyalty(ownerId: string, branchId: string, customerId: string): Promise<CustomerLoyalty | null> {
    const customer = await this.db.customer.findFirst({
      where: { customerId, ownerId, branchId },
      select: { id: true, customerId: true }
    });
    if (!customer) return null;

    const [config, movements] = await Promise.all([
      this.getConfig(ownerId),
      this.db.loyaltyMovement.findMany({
        where: { ownerId, branchId, customerId: customer.id },
        orderBy: { occurredAt: "asc" },
        select: {
          movementId: true,
          ownerId: true,
          branchId: true,
          customerId: true,
          type: true,
          pointsDelta: true,
          saleId: true,
          rewardId: true,
          reason: true,
          expiresAt: true,
          occurredAt: true
        }
      })
    ]);

    const mapped: LoyaltyMovement[] = movements.map((movement) => ({
      movementId: movement.movementId,
      ownerId: movement.ownerId,
      branchId: movement.branchId,
      customerId: customer.customerId,
      type: movement.type as LoyaltyMovement["type"],
      pointsDelta: movement.pointsDelta,
      saleId: movement.saleId,
      rewardId: movement.rewardId,
      reason: movement.reason,
      expiresAt: movement.expiresAt ? movement.expiresAt.toISOString() : null,
      occurredAt: movement.occurredAt.toISOString()
    }));

    const balance = computeLoyaltyBalance(
      movements.map((movement) => ({
        type: movement.type as LoyaltyMovementType,
        pointsDelta: movement.pointsDelta,
        occurredAt: movement.occurredAt.toISOString(),
        expiresAt: movement.expiresAt ? movement.expiresAt.toISOString() : null
      })),
      new Date(),
      config.expiryDays
    );

    return { customerId: customer.customerId, balance, movements: mapped };
  }

  async listRewards(ownerId: string): Promise<LoyaltyReward[]> {
    const rows = await this.db.loyaltyReward.findMany({
      where: { ownerId },
      orderBy: { pointsCost: "asc" },
      select: {
        rewardId: true,
        ownerId: true,
        name: true,
        kind: true,
        productId: true,
        discountCents: true,
        pointsCost: true,
        active: true,
        createdAt: true
      }
    });
    return rows.map((row) => ({
      rewardId: row.rewardId,
      ownerId: row.ownerId,
      name: row.name,
      kind: row.kind as LoyaltyReward["kind"],
      productId: row.productId,
      discountCents: row.discountCents,
      pointsCost: row.pointsCost,
      active: row.active,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async listPromotions(ownerId: string): Promise<Promotion[]> {
    const rows = await this.db.promotion.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        ownerId: true,
        name: true,
        kind: true,
        scope: true,
        productId: true,
        percentOffCents: true,
        fixedOffCents: true,
        buyQty: true,
        getQty: true,
        active: true,
        startsAt: true,
        endsAt: true,
        createdAt: true
      }
    });
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      kind: row.kind as Promotion["kind"],
      scope: row.scope as Promotion["scope"],
      productId: row.productId,
      percentOffCents: row.percentOffCents,
      fixedOffCents: row.fixedOffCents,
      buyQty: row.buyQty,
      getQty: row.getQty,
      active: row.active,
      startsAt: row.startsAt ? row.startsAt.toISOString() : null,
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      createdAt: row.createdAt.toISOString()
    }));
  }
}
