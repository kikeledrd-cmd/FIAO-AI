import { stockAdjustmentPayloadSchema, type StockAdjustmentPayload } from "@fiao/contracts/inventory";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { applyStockDelta } from "@fiao/domain/inventory/inventory-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Ajuste manual de stock (compra, merma, corrección).
 *
 * - Requiere rol OWNER o una OwnerAuthorization válida (purpose
 *   STOCK_ADJUSTMENT ligada al operationId) cuando el actor es CASHIER.
 * - Append-only: crea StockMovement tipo ADJUSTMENT; ProductStock es la
 *   proyección actualizada en la misma transacción.
 */
export async function processStockAdjustment(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = stockAdjustmentPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const authorized = await isOwnerAuthorized(
    context,
    envelope,
    { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
    "STOCK_ADJUSTMENT",
    db
  );
  if (!authorized) {
    return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
  }

  const product = await db.product.findFirst({
    where: { id: payload.productId, ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true, stockControl: true }
  });
  if (!product || !product.stockControl) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
  }

  const stock = await db.productStock.findUnique({ where: { productId: payload.productId } });
  let newOnHand: string;
  try {
    newOnHand = applyStockDelta(stock?.onHand ?? "0", payload.quantityDelta);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const occurredAt = parseOperationTimestamp(envelope.occurredAt);
  const normalizedDelta = normalizeDelta(payload.quantityDelta);

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

      await tx.productStock.upsert({
        where: { productId: payload.productId },
        update: { onHand: newOnHand },
        create: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          productId: payload.productId,
          onHand: newOnHand
        }
      });
      await tx.stockMovement.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          productId: payload.productId,
          type: "ADJUSTMENT",
          quantityDelta: normalizedDelta,
          clientOperationId: operation.id
        }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "STOCK_ADJUSTMENT_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { adjustmentId: payload.adjustmentId, productId: payload.productId, quantityDelta: normalizedDelta, reason: payload.reason, onHandAfter: newOnHand }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "STOCK_ADJUSTMENT",
          payload: {
            adjustmentId: payload.adjustmentId,
            productId: payload.productId,
            quantityDelta: normalizedDelta,
            reason: payload.reason,
            onHandAfter: newOnHand,
            occurredAt: occurredAt.toISOString()
          }
        },
        select: { seq: true }
      });

      const persistedResult = {
        operationId: envelope.operationId,
        status: "ACCEPTED" as const,
        latestCursor: change.seq.toString()
      };
      await tx.clientOperation.update({
        where: { id: operation.id },
        data: { status: "ACCEPTED", latestCursor: change.seq, result: persistedResult }
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

/** Reutilizable por SALE_REVERSAL: rol OWNER o autorización emitida y vigente. */
export async function isOwnerAuthorized(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  payload: { ownerAuthorizationId?: string | null },
  purpose: string,
  db: FiaoPrismaClient
): Promise<boolean> {
  if (context.role === "OWNER") return true;
  if (!payload.ownerAuthorizationId) return false;
  const authorization = await db.ownerAuthorization.findFirst({
    where: {
      id: payload.ownerAuthorizationId,
      ownerId: context.ownerId,
      branchId: context.branchId,
      purpose,
      targetOperationId: envelope.operationId,
      expiresAt: { gt: context.now }
    },
    select: { id: true }
  });
  return authorization !== null;
}

function normalizeDelta(value: string): string {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  if (!normalized.startsWith("-") && !/^\d/.test(normalized)) return normalized;
  return normalized;
}
