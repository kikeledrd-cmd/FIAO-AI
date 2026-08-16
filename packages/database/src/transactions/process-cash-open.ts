import { cashOpenPayloadSchema, type CashOpenPayload } from "@fiao/contracts/cash";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertNonNegativeCents } from "@fiao/domain/cash/cash-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Apertura de caja (spec §10.1): registra sucursal, responsable, float
 * inicial, fecha/hora y dispositivo. La abre el cajero.
 *
 * - Una sola sesión abierta por sucursal: garantizada por el índice único
 *   parcial `openUniqueKey` (branchId cuando OPEN, null cuando CLOSED).
 * - Idempotente por operationId.
 */
export async function processCashOpen(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = cashOpenPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const branch = await db.branch.findFirst({
    where: { id: payload.branchId, ownerId: context.ownerId, active: true },
    select: { id: true }
  });
  if (!branch) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_BRANCH", db);
  }

  try {
    assertNonNegativeCents(payload.openingFloatCents);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const existingOpen = await db.cashSession.findFirst({
    where: { ownerId: context.ownerId, branchId: payload.branchId, status: "OPEN" },
    select: { sessionId: true }
  });
  if (existingOpen) {
    return persistRejectedOperation(context, envelope, "CASH_SESSION_ALREADY_OPEN", db);
  }

  const occurredAt = parseOperationTimestamp(payload.occurredAt);

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

      await tx.cashSession.create({
        data: {
          ownerId: context.ownerId,
          branchId: payload.branchId,
          sessionId: payload.sessionId,
          status: "OPEN",
          openedById: context.userId,
          openedAt: occurredAt,
          openingFloatCents: payload.openingFloatCents,
          openUniqueKey: payload.branchId
        }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: payload.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "CASH_OPEN_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { sessionId: payload.sessionId, openingFloatCents: payload.openingFloatCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: payload.branchId,
          clientOperationId: operation.id,
          type: "CASH_OPEN",
          payload: {
            sessionId: payload.sessionId,
            branchId: payload.branchId,
            openingFloatCents: payload.openingFloatCents,
            openedAt: occurredAt.toISOString()
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
      // Colisión de openUniqueKey → otra sesión abierta ganó la carrera.
      return persistRejectedOperation(context, envelope, "CASH_SESSION_ALREADY_OPEN", db);
    }
    throw error;
  }
}

export type { CashOpenPayload };
