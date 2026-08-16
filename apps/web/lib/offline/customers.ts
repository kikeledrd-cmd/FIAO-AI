import type { Customer, CreditMovementChange } from "@fiao/contracts/credit";
import type { SyncChangeRecord } from "@fiao/contracts/sync";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export interface CustomerWithBalance extends Customer {
  balanceCents: number;
}

export async function loadCustomersFromServer(branchId: string): Promise<CustomerWithBalance[]> {
  const response = await apiJson<{ customers: CustomerWithBalance[] }>(
    `/api/customers?branchId=${encodeURIComponent(branchId)}`
  );
  return response.customers;
}

export async function saveCustomersLocally(
  customers: CustomerWithBalance[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (customers.length === 0) return;
  await database.transaction("rw", database.customers, async () => {
    const branchId = customers[0]!.branchId;
    await database.customers.where({ branchId }).delete();
    await database.customers.bulkPut(
      customers.map((customer) => ({
        customerId: customer.customerId,
        ownerId: customer.ownerId,
        branchId: customer.branchId,
        name: customer.name,
        phoneE164: customer.phoneE164 ?? null,
        creditLimitCents: customer.creditLimitCents,
        defaultPromiseDays: customer.defaultPromiseDays,
        active: customer.active,
        balanceCents: customer.balanceCents
      }))
    );
  });
}

export async function listCustomersLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<CustomerWithBalance[]> {
  const rows = await database.customers.where("branchId").equals(branchId).sortBy("name");
  return rows.map((row) => ({
    customerId: row.customerId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    name: row.name,
    phoneE164: row.phoneE164,
    creditLimitCents: row.creditLimitCents,
    defaultPromiseDays: row.defaultPromiseDays,
    active: row.active,
    balanceCents: row.balanceCents
  }));
}

/** Aplica deltas CUSTOMER del pull (upsert local). */
export async function upsertCustomersLocally(
  customers: CustomerDelta[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (customers.length === 0) return;
  await database.transaction("rw", database.customers, async () => {
    for (const customer of customers) {
      const existing = await database.customers.get(customer.customerId);
      await database.customers.put({
        customerId: customer.customerId,
        ownerId: customer.ownerId ?? existing?.ownerId ?? "",
        branchId: customer.branchId ?? existing?.branchId ?? "",
        name: customer.name,
        phoneE164: customer.phoneE164 ?? null,
        creditLimitCents: customer.creditLimitCents ?? 0,
        defaultPromiseDays: customer.defaultPromiseDays ?? 7,
        active: customer.active ?? true,
        balanceCents: existing?.balanceCents ?? 0
      });
    }
  });
}

export interface CustomerDelta {
  customerId: string;
  ownerId?: string;
  branchId?: string;
  name: string;
  phoneE164?: string | null;
  creditLimitCents?: number;
  defaultPromiseDays?: number;
  active?: boolean;
}

/** Aplica deltas CREDIT (FIAO_SALE/ABONO) a la réplica local de clientes. */
export async function applyCreditDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  const creditChanges = changes
    .filter((change) => change.type === "CREDIT")
    .map((change) => ({
      ownerId: change.ownerId,
      branchId: change.branchId,
      ...(change.payload as CreditMovementChange)
    }));
  const byCustomer = new Map<string, (CreditMovementChange & { ownerId: string; branchId: string })[]>();
  for (const change of creditChanges) {
    const list = byCustomer.get(change.customerId) ?? [];
    list.push(change);
    byCustomer.set(change.customerId, list);
  }
  if (byCustomer.size === 0) return;

  await database.transaction("rw", database.customers, database.creditMovements, async () => {
    for (const [customerId, deltas] of byCustomer) {
      const row = await database.customers.get(customerId);
      if (!row) continue;
      let delta = 0;
      for (const change of deltas) {
        delta += change.type === "FIAO_SALE" ? change.amountCents : -change.amountCents;
        await database.creditMovements.put({
          movementId: change.movementId,
          ownerId: change.ownerId,
          branchId: change.branchId,
          type: change.type,
          customerId: change.customerId,
          amountCents: change.amountCents,
          saleId: change.saleId ?? null,
          abonoId: change.abonoId ?? null,
          occurredAt: change.occurredAt
        });
      }
      row.balanceCents = Math.max(0, row.balanceCents + delta);
      await database.customers.put(row);
    }
  });
}
