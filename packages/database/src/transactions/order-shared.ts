import type { CommandContext } from "@fiao/domain/context";
import {
  addReservation,
  availableQuantity,
  releaseReservation
} from "@fiao/domain/apartado/apartado-policy";
import { parseSaleQuantity, saleLineTotalCents } from "@fiao/domain/sales/sale-policy";
import type { FiaoPrismaClient } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export interface OrderLineInput {
  productId: string;
  quantity: string;
  priceCents: number;
}

export interface OrderRow {
  id: string;
  orderId: string;
  status: string;
  customerId: string | null;
  lines: OrderLineInput[];
  totalCents: number;
  deliveryName: string | null;
  deliveryAddress: string | null;
  deliveryFeeCents: number;
  notes: string | null;
  exceptionReason: string | null;
  saleId: string | null;
  source: string;
}

export function orderLineTotalCents(priceCents: number, quantity: string): number {
  return saleLineTotalCents(priceCents, quantity);
}

export function orderSubtotalCents(lines: OrderLineInput[]): number {
  return lines.reduce((sum, line) => sum + saleLineTotalCents(line.priceCents, line.quantity), 0);
}

export async function findOrderByOrderId(
  db: FiaoPrismaClient,
  context: CommandContext,
  orderId: string
): Promise<OrderRow | null> {
  const order = await db.order.findFirst({
    where: { orderId, ownerId: context.ownerId, branchId: context.branchId },
    select: {
      id: true,
      orderId: true,
      status: true,
      customerId: true,
      lines: true,
      totalCents: true,
      deliveryName: true,
      deliveryAddress: true,
      deliveryFeeCents: true,
      notes: true,
      exceptionReason: true,
      saleId: true,
      source: true
    }
  });
  if (!order) return null;
  return { ...order, lines: (order.lines as unknown) as OrderLineInput[] };
}

/** Reserva stock para las líneas (disponible = onHand − reserved). */
export async function reserveStockForOrder(
  tx: Prisma.TransactionClient,
  context: CommandContext,
  operationId: string,
  lines: OrderLineInput[]
): Promise<void> {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true, stockControl: true }
  });
  const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));

  for (const line of lines) {
    if (!stockControlIds.has(line.productId)) continue;
    const stock = await tx.productStock.findUnique({
      where: { productId: line.productId },
      select: { onHand: true, reserved: true }
    });
    const onHand = stock?.onHand ?? "0";
    const reserved = stock?.reserved ?? "0";
    const available = availableQuantity(onHand, reserved);
    const requested = parseSaleQuantity(line.quantity).scaled;
    if (parseSaleQuantity(available).scaled < requested) {
      throw new Error("STOCK_INSUFFICIENT");
    }
    await tx.productStock.upsert({
      where: { productId: line.productId },
      update: { reserved: addReservation(reserved, line.quantity) },
      create: {
        ownerId: context.ownerId,
        branchId: context.branchId,
        productId: line.productId,
        onHand: "0",
        reserved: addReservation(reserved, line.quantity)
      }
    });
    await tx.stockMovement.create({
      data: {
        ownerId: context.ownerId,
        branchId: context.branchId,
        productId: line.productId,
        type: "RESERVATION",
        quantityDelta: `+${line.quantity}`,
        clientOperationId: operationId
      }
    });
  }
}

/** Libera la reserva de las líneas (reserved −= qty, saturado en 0). */
export async function releaseStockForOrder(
  tx: Prisma.TransactionClient,
  context: CommandContext,
  operationId: string,
  lines: OrderLineInput[]
): Promise<void> {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true, stockControl: true }
  });
  const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));

  for (const line of lines) {
    if (!stockControlIds.has(line.productId)) continue;
    const stock = await tx.productStock.findUnique({
      where: { productId: line.productId },
      select: { reserved: true }
    });
    const reserved = stock?.reserved ?? "0";
    await tx.productStock.upsert({
      where: { productId: line.productId },
      update: { reserved: releaseReservation(reserved, line.quantity) },
      create: {
        ownerId: context.ownerId,
        branchId: context.branchId,
        productId: line.productId,
        onHand: "0",
        reserved: "0"
      }
    });
    await tx.stockMovement.create({
      data: {
        ownerId: context.ownerId,
        branchId: context.branchId,
        productId: line.productId,
        type: "RESERVATION_RELEASE",
        quantityDelta: `-${line.quantity}`,
        clientOperationId: operationId
      }
    });
  }
}

/** Crea el syncChange de tipo ORDER y devuelve su seq. */
export async function pushOrderSyncChange(
  tx: Prisma.TransactionClient,
  context: CommandContext,
  operationId: string,
  payload: Record<string, unknown>
): Promise<bigint> {
  const change = await tx.syncChange.create({
    data: {
      ownerId: context.ownerId,
      branchId: context.branchId,
      clientOperationId: operationId,
      type: "ORDER",
      payload: payload as never
    },
    select: { seq: true }
  });
  return change.seq;
}
