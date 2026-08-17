import type { Promotion } from "@fiao/contracts/promotions";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export async function loadPromotionsFromServer(branchId: string): Promise<Promotion[]> {
  const response = await apiJson<{ promotions: Promotion[] }>(
    `/api/promotions?branchId=${encodeURIComponent(branchId)}`
  );
  return response.promotions;
}

export async function savePromotionsLocally(
  promotions: Promotion[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (promotions.length === 0) return;
  await database.transaction("rw", database.promotions, async () => {
    await database.promotions.clear();
    await database.promotions.bulkPut(
      promotions.map((promotion) => ({
        id: promotion.id,
        ownerId: promotion.ownerId,
        name: promotion.name,
        kind: promotion.kind,
        scope: promotion.scope,
        productId: promotion.productId,
        percentOffCents: promotion.percentOffCents,
        fixedOffCents: promotion.fixedOffCents,
        buyQty: promotion.buyQty,
        getQty: promotion.getQty,
        active: promotion.active,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt
      }))
    );
  });
}

export async function listPromotionsLocally(
  ownerId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<Promotion[]> {
  const rows = await database.promotions.where("ownerId").equals(ownerId).toArray();
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    kind: row.kind,
    scope: row.scope,
    productId: row.productId,
    percentOffCents: row.percentOffCents,
    fixedOffCents: row.fixedOffCents,
    buyQty: row.buyQty,
    getQty: row.getQty,
    active: row.active,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdAt: ""
  }));
}
