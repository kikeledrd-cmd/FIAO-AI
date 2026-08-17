import type { Apartado } from "@fiao/contracts/apartado";
import { databaseClient, type FiaoPrismaClient } from "../client";

/** Lista apartados de una sucursal (todos los estados, más recientes primero). */
export class ApartadoRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listByBranch(ownerId: string, branchId: string): Promise<Apartado[]> {
    const rows = await this.db.apartado.findMany({
      where: { ownerId, branchId },
      orderBy: { createdAt: "desc" },
      select: {
        apartadoId: true,
        ownerId: true,
        branchId: true,
        customerId: true,
        status: true,
        depositCents: true,
        totalCents: true,
        promiseDate: true,
        notes: true,
        actorUserId: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
        customer: { select: { customerId: true } },
        lines: {
          select: { productId: true, quantity: true, priceCents: true, lineTotalCents: true }
        }
      }
    });
    return rows.map((row) => ({
      apartadoId: row.apartadoId,
      ownerId: row.ownerId,
      branchId: row.branchId,
      customerId: row.customer.customerId,
      status: row.status as Apartado["status"],
      lines: row.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        priceCents: line.priceCents,
        lineTotalCents: line.lineTotalCents
      })),
      depositCents: row.depositCents,
      totalCents: row.totalCents,
      promiseDate: row.promiseDate ? row.promiseDate.toISOString() : null,
      notes: row.notes,
      actorUserId: row.actorUserId,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      createdAt: row.createdAt.toISOString()
    }));
  }
}
