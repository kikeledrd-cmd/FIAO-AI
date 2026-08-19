import { orderCreatePayloadSchema, type OrderCreatePayload } from "@fiao/contracts/orders";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { orderLineTotalCents, orderSubtotalCents, pushOrderSyncChange } from "./order-shared";
import { duplicateResult, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Crea un pedido en estado NEW (WhatsApp, manual o repetir). No reserva
 * inventario todavía: la reserva ocurre al aceptar (ORDER_ACCEPT). El total
 * se computa de las líneas + deliveryFee (nunca lo envía el cliente).
 *
 * Append-only + idempotente por operationId.
 */
export async function processOrderCreate(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = orderCreatePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  // Cliente opcional (solo si el pedido se identifica como de un cliente).
  let customerPkId: string | null = null;
  if (payload.customerId) {
    const customer = await db.customer.findFirst({
      where: { customerId: payload.customerId, ownerId: context.ownerId, branchId: context.branchId },
      select: { id: true }
    });
    if (!customer) {
      return persistRejectedOperation(context, envelope, "UNKNOWN_CUSTOMER", db);
    }
    customerPkId = customer.id;
  }

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true }
  });
  if (products.length !== productIds.length) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
  }

  const subtotal = orderSubtotalCents(payload.lines);
  const deliveryFee = payload.deliveryFeeCents ?? 0;
  const totalCents = subtotal + deliveryFee;

  const occurredAt = parseOperationTimestamp(envelope.occurredAt);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (duplicate?.status && duplicate.latestCursor !== null) {
        return duplicateResult(duplicate.operationId, duplicate.status, duplicate.result, duplicate.latestCursor);
      }

      const operation = await tx.clientOperation.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          operationId: envelope.operationId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          type: envelope.type,
          occurredAt,
          baseCursor: envelope.baseCursor === null ? null : BigInt(envelope.baseCursor),
          payload: envelope.payload as never
        },
        select: { id: true }
      });

      const order = await tx.order.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: payload.orderId,
          source: payload.source,
          status: "NEW",
          ...(customerPkId ? { customerId: customerPkId } : {}),
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          lines: payload.lines as never,
          totalCents,
          ...(payload.deliveryName ? { deliveryName: payload.deliveryName } : {}),
          ...(payload.deliveryAddress ? { deliveryAddress: payload.deliveryAddress } : {}),
          deliveryFeeCents: deliveryFee,
          ...(payload.notes ? { notes: payload.notes } : {}),
          occurredAt
        },
        select: { id: true, orderId: true }
      });

      for (const line of payload.lines) {
        await tx.orderLine.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            orderId: order.id,
            productId: line.productId,
            quantity: line.quantity,
            priceCents: line.priceCents,
            lineTotalCents: orderLineTotalCents(line.priceCents, line.quantity)
          }
        });
      }

      await tx.orderTimelineEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: order.id,
          status: "NEW",
          actorUserId: context.userId,
          note: payload.source === "WHATSAPP" ? "Pedido recibido por WhatsApp" : "Pedido creado manualmente",
          occurredAt
        }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "ORDER_CREATED",
          targetOperationId: envelope.operationId,
          payload: { orderId: order.orderId, source: payload.source, totalCents }
        }
      });

      const seq = await pushOrderSyncChange(tx, context, operation.id, {
        orderId: order.orderId,
        status: "NEW",
        source: payload.source,
        customerId: payload.customerId ?? null,
        lines: payload.lines,
        totalCents,
        deliveryName: payload.deliveryName ?? null,
        deliveryAddress: payload.deliveryAddress ?? null,
        deliveryFeeCents: deliveryFee,
        notes: payload.notes ?? null,
        occurredAt: occurredAt.toISOString()
      });

      const persistedResult = {
        operationId: envelope.operationId,
        status: "ACCEPTED" as const,
        latestCursor: seq.toString()
      };
      await tx.clientOperation.update({
        where: { id: operation.id },
        data: { status: "ACCEPTED", latestCursor: seq, result: persistedResult }
      });
      return persistedResult satisfies OperationResult;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await db.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (existing?.status && existing.latestCursor !== null) {
        return duplicateResult(existing.operationId, existing.status, existing.result, existing.latestCursor);
      }
    }
    throw error;
  }
}
