import type { Order } from "@fiao/contracts/orders";
import { databaseClient, type FiaoPrismaClient } from "../client";

/** Lista pedidos de una sucursal (todos los estados, más recientes primero). */
export class OrderRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async listByBranch(ownerId: string, branchId: string): Promise<Order[]> {
    const rows = await this.db.order.findMany({
      where: { ownerId, branchId },
      orderBy: { createdAt: "desc" },
      select: {
        orderId: true,
        ownerId: true,
        branchId: true,
        source: true,
        status: true,
        customerId: true,
        lines: true,
        deliveryName: true,
        deliveryAddress: true,
        deliveryFeeCents: true,
        totalCents: true,
        notes: true,
        exceptionReason: true,
        saleId: true,
        createdAt: true,
        customer: { select: { customerId: true } },
        orderLines: {
          select: { productId: true, quantity: true, priceCents: true, lineTotalCents: true }
        },
        timeline: {
          orderBy: { occurredAt: "asc" },
          select: { status: true, actorUserId: true, note: true, occurredAt: true }
        }
      }
    });
    return rows.map((row) => ({
      orderId: row.orderId,
      ownerId: row.ownerId,
      branchId: row.branchId,
      source: row.source as Order["source"],
      status: row.status as Order["status"],
      customerId: row.customer?.customerId ?? null,
      lines: row.orderLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        priceCents: line.priceCents,
        lineTotalCents: line.lineTotalCents
      })),
      deliveryName: row.deliveryName,
      deliveryAddress: row.deliveryAddress,
      deliveryFeeCents: row.deliveryFeeCents,
      totalCents: row.totalCents,
      notes: row.notes,
      exceptionReason: row.exceptionReason,
      saleId: row.saleId,
      createdAt: row.createdAt.toISOString(),
      timeline: row.timeline.map((event) => ({
        status: event.status as Order["timeline"][number]["status"],
        at: event.occurredAt.toISOString(),
        actorUserId: event.actorUserId,
        note: event.note
      }))
    }));
  }
}
