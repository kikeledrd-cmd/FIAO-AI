import type { CatalogProduct } from "@fiao/contracts/sales";
import { addDecimalQuantities, subtractDecimalQuantities } from "@fiao/domain/sales/sale-policy";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export async function loadCatalogFromServer(branchId: string): Promise<CatalogProduct[]> {
  const response = await apiJson<{ products: CatalogProduct[] }>(
    `/api/catalog?branchId=${encodeURIComponent(branchId)}`
  );
  return response.products;
}

export async function saveCatalogLocally(
  products: CatalogProduct[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (products.length === 0) return;
  await database.transaction("rw", database.catalog, async () => {
    const branchId = products[0]!.branchId;
    const ownerId = products[0]!.ownerId;
    await database.catalog.where({ branchId }).delete();
    await database.catalog.bulkPut(
      products.map((product) => ({
        productId: product.id,
        ownerId,
        branchId,
        name: product.name,
        barcode: product.barcode,
        priceCents: product.priceCents,
        stockControl: product.stockControl,
        unitLabel: product.unitLabel,
        onHand: product.onHand,
        active: product.active
      }))
    );
  });
}

export async function listCatalogLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<CatalogProduct[]> {
  const rows = await database.catalog.where("branchId").equals(branchId).sortBy("name");
  return rows.map((row) => ({
    id: row.productId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    name: row.name,
    barcode: row.barcode,
    priceCents: row.priceCents,
    stockControl: row.stockControl,
    unitLabel: row.unitLabel,
    onHand: row.onHand,
    active: row.active
  }));
}

/** Actualiza el stock local tras confirmar una venta (proyección optimista). */
export async function adjustLocalStock(
  branchId: string,
  deltas: { productId: string; quantity: string }[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (deltas.length === 0) return;
  await database.transaction("rw", database.catalog, async () => {
    for (const delta of deltas) {
      const row = await database.catalog.get(delta.productId);
      if (!row || !row.stockControl) continue;
      row.onHand = subtractDecimalQuantities(row.onHand ?? "0", delta.quantity);
      await database.catalog.put(row);
    }
  });
}

/**
 * Aplica deltas de stock con signo ("5" suma, "-2" resta) a la réplica
 * local. Usado por REVERSAL (restaura stock) y STOCK_ADJUSTMENT.
 */
export async function applySignedStockDeltas(
  branchId: string,
  deltas: { productId: string; quantityDelta: string }[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (deltas.length === 0) return;
  await database.transaction("rw", database.catalog, async () => {
    for (const delta of deltas) {
      const row = await database.catalog.get(delta.productId);
      if (!row || !row.stockControl) continue;
      const current = row.onHand ?? "0";
      row.onHand = delta.quantityDelta.startsWith("-")
        ? subtractDecimalQuantities(current, delta.quantityDelta.slice(1))
        : addDecimalQuantities(current, delta.quantityDelta.replace(/^\+/, ""));
      await database.catalog.put(row);
    }
  });
}
