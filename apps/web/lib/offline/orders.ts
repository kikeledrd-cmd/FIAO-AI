import type { Order } from "@fiao/contracts/orders";
import { apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";

export async function loadOrdersFromServer(branchId: string): Promise<Order[]> {
  const response = await apiJson<{ orders: Order[] }>(
    `/api/orders?branchId=${encodeURIComponent(branchId)}`
  );
  return response.orders;
}

export async function saveOrdersLocally(
  orders: Order[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (orders.length === 0) return;
  await database.transaction("rw", database.orders, async () => {
    const branchId = orders[0]!.branchId;
    await database.orders.where({ branchId }).delete();
    await database.orders.bulkPut(
      orders.map((order) => ({
        orderId: order.orderId,
        ownerId: order.ownerId,
        branchId: order.branchId,
        source: order.source,
        status: order.status,
        customerId: order.customerId,
        lines: order.lines,
        deliveryName: order.deliveryName,
        deliveryAddress: order.deliveryAddress,
        deliveryFeeCents: order.deliveryFeeCents,
        totalCents: order.totalCents,
        notes: order.notes,
        exceptionReason: order.exceptionReason,
        saleId: order.saleId,
        occurredAt: order.createdAt
      }))
    );
  });
}

export async function listOrdersLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<Order[]> {
  const rows = await database.orders.where("branchId").equals(branchId).reverse().sortBy("occurredAt");
  return rows.map((row) => ({
    orderId: row.orderId,
    ownerId: row.ownerId,
    branchId: row.branchId,
    source: row.source,
    status: row.status,
    customerId: row.customerId,
    lines: row.lines,
    deliveryName: row.deliveryName,
    deliveryAddress: row.deliveryAddress,
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    notes: row.notes,
    exceptionReason: row.exceptionReason,
    saleId: row.saleId,
    createdAt: row.occurredAt,
    timeline: []
  }));
}
