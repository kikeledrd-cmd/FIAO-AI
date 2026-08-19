import { orderCancelPayloadSchema } from "@fiao/contracts/orders";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertOrderTransitionValid,
  orderCancelRequiresAuthorization
} from "@fiao/domain/orders/order-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { isOwnerAuthorized } from "./process-stock-adjustment";
import { findOrderByOrderId, pushOrderSyncChange, releaseStockForOrder } from "./order-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Cancela un pedido. Si ya estaba aceptado (reserva activa), libera el stock
 * (reserved −= qty). Cancelar antes de PREPARING es libre; a partir de
 * PREPARING el cajero necesita autorización de OWNER (purpose ORDER_CANCEL).
 *
 * Append-only + idempotente por operationId.
 */
export async function processOrderCancel(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = orderCancelPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const order = await findOrderByOrderId(db, context, payload.orderId);
  if (!order) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_ORDER", db);
  }

  if (orderCancelRequiresAuthorization(order.status as never)) {
    const authorized = await isOwnerAuthorized(
      context,
      envelope,
      { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
      "ORDER_CANCEL",
      db
    );
    if (!authorized) {
      return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
    }
  }

  try {
    assertOrderTransitionValid(order.status as never, "CANCELLED");
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

      // Libera reserva solo si el pedido ya estaba aceptado (reserva activa).
      if (order.status !== "NEW") {
        await releaseStockForOrder(tx, context, operation.id, order.lines);
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" }
      });
      await tx.orderTimelineEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: order.id,
          status: "CANCELLED",
          actorUserId: context.userId,
          note: payload.reason,
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
          action: "ORDER_CANCELLED",
          targetOperationId: envelope.operationId,
          payload: { orderId: order.orderId, reason: payload.reason }
        }
      });

      const seq = await pushOrderSyncChange(tx, context, operation.id, {
        orderId: order.orderId,
        status: "CANCELLED",
        reason: payload.reason,
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
