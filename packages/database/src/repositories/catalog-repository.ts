import type { CatalogProduct } from "@fiao/contracts/sales";
import { databaseClient, type FiaoPrismaClient } from "../client";

export class CatalogRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listActiveByBranch(ownerId: string, branchId: string): Promise<CatalogProduct[]> {
    const rows = await this.db.product.findMany({
      where: { ownerId, branchId, active: true },
      include: { stock: { select: { onHand: true } } },
      orderBy: { name: "asc" }
    });
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      branchId: row.branchId,
      name: row.name,
      barcode: row.barcode,
      priceCents: row.priceCents,
      stockControl: row.stockControl,
      unitLabel: row.unitLabel,
      onHand: row.stock?.onHand ?? null,
      active: row.active
    }));
  }
}
