import { orderAcceptPayloadSchema } from "@fiao/contracts/orders";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertOrderTransitionValid } from "@fiao/domain/orders/order-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { findOrderByOrderId, pushOrderSyncChange, reserveStockForOrder } from "./order-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Acepta un pedido (NEW → PREPARING): reserva inventario (reserved += qty).
 * Si el stock disponible es insuficiente la operación se rechaza y el pedido
 * permanece en NEW (queda como excepción para el operador).
 *
 * Append-only + idempotente por operationId.
 */
export async function processOrderAccept(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = orderAcceptPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const order = await findOrderByOrderId(db, context, payload.orderId);
  if (!order) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_ORDER", db);
  }
  try {
    assertOrderTransitionValid(order.status as never, "PREPARING");
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

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

      await reserveStockForOrder(tx, context, operation.id, order.lines);

      await tx.order.update({
        where: { id: order.id },
        data: { status: "PREPARING" }
      });
      await tx.orderTimelineEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: order.id,
          status: "PREPARING",
          actorUserId: context.userId,
          note: null,
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
          action: "ORDER_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { orderId: order.orderId }
        }
      });

      const seq = await pushOrderSyncChange(tx, context, operation.id, {
        orderId: order.orderId,
        status: "PREPARING",
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
    if (error instanceof Error && error.message === "STOCK_INSUFFICIENT") {
      return persistRejectedOperation(context, envelope, "STOCK_INSUFFICIENT", db);
    }
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
