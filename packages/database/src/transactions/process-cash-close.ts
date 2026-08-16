import { cashClosePayloadSchema, type CashClosePayload } from "@fiao/contracts/cash";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertCanClose, assertNonNegativeCents } from "@fiao/domain/cash/cash-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { computeExpectedCashForSession, findOpenCashSession, isOwnerAuthorized } from "./cash-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Cierre/arqueo de caja (spec §10.5): el cajero ingresa el efectivo contado;
 * FIAO computa el esperado y muestra la diferencia.
 *
 * - Diferencia 0: cierra el cajero sin autorización.
 * - Diferencia ≠ 0: cajero requiere OwnerAuthorization purpose CASH_CLOSE;
 *   el OWNER cierra con diferencia sin autorización.
 * - Si hay diferencia se registra un CashMovement DIFFERENCE (append-only)
 *   para que el ledger cuadre con lo contado; `differenceCents` queda en la
 *   sesión cerrada para auditoría.
 */
export async function processCashClose(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = cashClosePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const sessionResult = await findOpenCashSession(db, context, payload.sessionId);
  if (sessionResult.errorCode !== null) {
    return persistRejectedOperation(context, envelope, sessionResult.errorCode, db);
  }
  const session = sessionResult.session;

  try {
    assertNonNegativeCents(payload.countedCents);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const expectedCents = await computeExpectedCashForSession(db, context, session);
  const differenceCents = payload.countedCents - expectedCents;

  if (context.role !== "OWNER" && differenceCents !== 0) {
    if (!payload.ownerAuthorizationId) {
      return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
    }
    const authorized = await isOwnerAuthorized(
      context,
      envelope,
      { ownerAuthorizationId: payload.ownerAuthorizationId },
      "CASH_CLOSE",
      db
    );
    if (!authorized) {
      return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
    }
  }

  try {
    assertCanClose(context.role, differenceCents, payload.ownerAuthorizationId !== undefined);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
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

      if (differenceCents !== 0) {
        await tx.cashMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            sessionId: session.id,
            movementId: crypto.randomUUID(),
            type: "DIFFERENCE",
            amountCents: differenceCents,
            category: "Arqueo",
            description: "Diferencia de cierre registrada para cuadrar el ledger",
            actorUserId: context.userId,
            deviceId: context.deviceId,
            clientOperationId: operation.id,
            occurredAt
          }
        });
      }

      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          closedById: context.userId,
          closedAt: occurredAt,
          countedCents: payload.countedCents,
          differenceCents,
          openUniqueKey: null
        }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "CASH_CLOSE_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { sessionId: payload.sessionId, countedCents: payload.countedCents, expectedCents, differenceCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "CASH_CLOSE",
          payload: {
            sessionId: payload.sessionId,
            countedCents: payload.countedCents,
            expectedCents,
            differenceCents,
            closedAt: occurredAt.toISOString()
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

export type { CashClosePayload };
