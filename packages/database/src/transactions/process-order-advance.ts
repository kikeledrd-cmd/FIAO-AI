import { orderAdvancePayloadSchema } from "@fiao/contracts/orders";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertOrderTransitionValid } from "@fiao/domain/orders/order-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { findOrderByOrderId, pushOrderSyncChange } from "./order-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Avanza un pedido (PREPARING → READY → ON_THE_WAY). No toca stock ni caja.
 * Opcionalmente actualiza el nombre/label de entrega (deliveryName).
 *
 * Append-only + idempotente por operationId.
 */
export async function processOrderAdvance(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = orderAdvancePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const order = await findOrderByOrderId(db, context, payload.orderId);
  if (!order) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_ORDER", db);
  }
  try {
    assertOrderTransitionValid(order.status as never, payload.nextStatus);
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

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: payload.nextStatus,
          ...(payload.deliveryName ? { deliveryName: payload.deliveryName } : {})
        }
      });
      await tx.orderTimelineEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: order.id,
          status: payload.nextStatus,
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
          action: "ORDER_ADVANCED",
          targetOperationId: envelope.operationId,
          payload: { orderId: order.orderId, nextStatus: payload.nextStatus }
        }
      });

      const seq = await pushOrderSyncChange(tx, context, operation.id, {
        orderId: order.orderId,
        status: payload.nextStatus,
        deliveryName: payload.deliveryName ?? order.deliveryName,
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
