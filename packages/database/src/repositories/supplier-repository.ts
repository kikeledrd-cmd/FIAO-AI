import type { FiaoPrismaClient } from "../client";
import { databaseClient } from "../client";

export interface SupplierWithStats {
  supplierId: string;
  name: string;
  phoneE164: string | null;
  active: boolean;
  purchaseCount: number;
  totalPurchasedCents: number;
}

/** Lista proveedores de una sucursal con estadísticas de compras. */
export class SupplierRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listByBranch(ownerId: string, branchId: string): Promise<SupplierWithStats[]> {
    const suppliers = await this.db.supplier.findMany({
      where: { ownerId, branchId, active: true },
      orderBy: { name: "asc" },
      select: {
        supplierId: true,
        name: true,
        phoneE164: true,
        active: true,
        purchases: {
          where: { branchId },
          select: { totalCents: true }
        }
      }
    });
    return suppliers.map((supplier) => ({
      supplierId: supplier.supplierId,
      name: supplier.name,
      phoneE164: supplier.phoneE164,
      active: supplier.active,
      purchaseCount: supplier.purchases.length,
      totalPurchasedCents: supplier.purchases.reduce((sum, purchase) => sum + purchase.totalCents, 0)
    }));
  }
}
