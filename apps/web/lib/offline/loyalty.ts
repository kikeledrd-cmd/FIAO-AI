import type { LoyaltyConfig, LoyaltyMovement, LoyaltyReward } from "@fiao/contracts/loyalty";
import { computeLoyaltyBalance, type LoyaltyMovementType } from "@fiao/domain/loyalty/loyalty-policy";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export interface CustomerLoyalty {
  customerId: string;
  balance: number;
  movements: LoyaltyMovement[];
}

interface LoyaltyResponse {
  config: LoyaltyConfig;
  loyalty: CustomerLoyalty | null;
}

export async function loadLoyaltyFromServer(
  branchId: string,
  customerId?: string
): Promise<LoyaltyResponse> {
  const query = customerId
    ? `?branchId=${encodeURIComponent(branchId)}&customerId=${encodeURIComponent(customerId)}`
    : `?branchId=${encodeURIComponent(branchId)}`;
  return apiJson<LoyaltyResponse>(`/api/loyalty${query}`);
}

export async function saveRewardsLocally(
  rewards: LoyaltyReward[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (rewards.length === 0) return;
  await database.transaction("rw", database.loyaltyRewards, async () => {
    await database.loyaltyRewards.clear();
    await database.loyaltyRewards.bulkPut(
      rewards.map((reward) => ({
        rewardId: reward.rewardId,
        ownerId: reward.ownerId,
        name: reward.name,
        kind: reward.kind,
        productId: reward.productId,
        discountCents: reward.discountCents,
        pointsCost: reward.pointsCost,
        active: reward.active
      }))
    );
  });
}

export async function listRewardsLocally(
  ownerId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<LoyaltyReward[]> {
  const rows = await database.loyaltyRewards.where("ownerId").equals(ownerId).sortBy("pointsCost");
  return rows.map((row) => ({
    rewardId: row.rewardId,
    ownerId: row.ownerId,
    name: row.name,
    kind: row.kind,
    productId: row.productId,
    discountCents: row.discountCents,
    pointsCost: row.pointsCost,
    active: row.active,
    createdAt: ""
  }));
}

export async function saveLoyaltyConfigLocally(
  ownerId: string,
  config: LoyaltyConfig,
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  await database.loyaltyConfig.put({ ownerId, ...config });
}

export async function listLoyaltyMovementsLocally(
  branchId: string,
  customerId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<LoyaltyMovement[]> {
  const rows = await database.loyaltyMovements
    .where("branchId")
    .equals(branchId)
    .filter((row) => row.customerId === customerId)
    .sortBy("occurredAt");
  return rows.map((row) => ({
    movementId: row.movementId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    customerId: row.customerId,
    type: row.type as LoyaltyMovement["type"],
    pointsDelta: row.pointsDelta,
    saleId: row.saleId,
    rewardId: row.rewardId,
    reason: null,
    expiresAt: row.expiresAt,
    occurredAt: row.occurredAt
  }));
}

export function computeBalanceLocally(
  movements: LoyaltyMovement[],
  expiryDays: number
): number {
  return computeLoyaltyBalance(
    movements.map((movement) => ({
      type: movement.type as LoyaltyMovementType,
      pointsDelta: movement.pointsDelta,
      occurredAt: movement.occurredAt,
      expiresAt: movement.expiresAt
    })),
    new Date(),
    expiryDays
  );
}
