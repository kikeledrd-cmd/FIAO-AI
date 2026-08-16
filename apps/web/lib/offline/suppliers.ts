import type { SyncChangeRecord } from "@fiao/contracts/sync";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export interface LocalSupplier {
  supplierId: string;
  ownerId: string;
  branchId: string;
  name: string;
  phoneE164: string | null;
  active: boolean;
}

export async function loadSuppliersFromServer(branchId: string): Promise<LocalSupplier[]> {
  const response = await apiJson<{ suppliers: LocalSupplier[] }>(
    `/api/suppliers?branchId=${encodeURIComponent(branchId)}`
  );
  return response.suppliers;
}

export async function saveSuppliersLocally(
  suppliers: LocalSupplier[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (suppliers.length === 0) return;
  await database.transaction("rw", database.suppliers, async () => {
    const branchId = suppliers[0]!.branchId;
    await database.suppliers.where({ branchId }).delete();
    await database.suppliers.bulkPut(suppliers);
  });
}

export async function listSuppliersLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<LocalSupplier[]> {
  const rows = await database.suppliers.where("branchId").equals(branchId).sortBy("name");
  return rows.filter((supplier) => supplier.active);
}

/** Aplica deltas SUPPLIER del pull (upsert local). */
export async function upsertSuppliersLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  const deltas = changes
    .filter((change) => change.type === "SUPPLIER")
    .map((change) => change.payload as Partial<LocalSupplier> & { supplierId: string });
  if (deltas.length === 0) return;

  await database.transaction("rw", database.suppliers, async () => {
    for (const delta of deltas) {
      const existing = await database.suppliers.get(delta.supplierId);
      await database.suppliers.put({
        supplierId: delta.supplierId,
        ownerId: delta.ownerId ?? existing?.ownerId ?? "",
        branchId: delta.branchId ?? existing?.branchId ?? "",
        name: delta.name ?? existing?.name ?? "",
        phoneE164: delta.phoneE164 ?? existing?.phoneE164 ?? null,
        active: delta.active ?? existing?.active ?? true
      });
    }
  });
}
