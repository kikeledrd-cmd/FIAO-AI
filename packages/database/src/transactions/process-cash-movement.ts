import {
  cashExpensePayloadSchema,
  cashInjectionPayloadSchema,
  cashWithdrawalPayloadSchema
} from "@fiao/contracts/cash";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertExpenseAllowed,
  assertOwnerProtectedMovement,
  assertPositiveCents
} from "@fiao/domain/cash/cash-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { findOpenCashSession, isOwnerAuthorized } from "./cash-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

export type CashMovementType = "EXPENSE" | "WITHDRAWAL" | "INJECTION";

interface CashMovementPayload {
  movementId: string;
  sessionId: string;
  amountCents: number;
  category: string | null | undefined;
  description: string | null | undefined;
  reason: string | null | undefined;
  ownerAuthorizationId: string | null | undefined;
  occurredAt: string;
}

/**
 * Movimientos de caja append-only (spec §10.2–10.4): EXPENSE, WITHDRAWAL,
 * INJECTION. Reglas de autorización:
 *
 * - EXPENSE: cajero hasta `CASHIER_EXPENSE_LIMIT_CENTS` sin autorización;
 *   mayor → OwnerAuthorization purpose CASH_EXPENSE. OWNER pasa directo.
 * - WITHDRAWAL / INJECTION: siempre OwnerAuthorization (purpose homónimo)
 *   para el cajero.
 *
 * Solo se escriben en sesión abierta (CASH_SESSION_REQUIRED/CLOSED).
 */
export async function processCashMovement(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = parseMovementPayload(envelope.type, envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.payload;

  const sessionResult = await findOpenCashSession(db, context, payload.sessionId);
  if (sessionResult.errorCode !== null) {
    return persistRejectedOperation(context, envelope, sessionResult.errorCode, db);
  }

  try {
    assertPositiveCents(payload.amountCents);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  // Autorización de OWNER: rol OWNER pasa directo; el cajero necesita una
  // OwnerAuthorization válida según el tipo y el monto.
  if (context.role !== "OWNER") {
    if (payload.ownerAuthorizationId) {
      const authorized = await isOwnerAuthorized(
        context,
        envelope,
        { ownerAuthorizationId: payload.ownerAuthorizationId },
        authorizationPurpose(envelope.type),
        db
      );
      if (!authorized) {
        return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
      }
    } else {
      try {
        if (envelope.type === "CASH_EXPENSE") {
          assertExpenseAllowed(context.role, payload.amountCents, false);
        } else {
          assertOwnerProtectedMovement(context.role, false);
        }
      } catch (error) {
        return persistRejectedOperation(context, envelope, errorMessage(error), db);
      }
    }
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

      const movement = await tx.cashMovement.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          sessionId: sessionResult.session.id,
          movementId: payload.movementId,
          type: movementType(envelope.type),
          amountCents: payload.amountCents,
          category: payload.category ?? null,
          description: payload.description ?? null,
          reason: payload.reason ?? null,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
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
          action: "CASH_MOVEMENT_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { movementId: payload.movementId, type: movement.type, amountCents: payload.amountCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: envelope.type,
          payload: {
            movementId: payload.movementId,
            sessionId: payload.sessionId,
            type: movement.type,
            amountCents: payload.amountCents,
            category: payload.category ?? null,
            description: payload.description ?? null,
            reason: payload.reason ?? null,
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

function parseMovementPayload(
  type: string,
  payload: unknown
): { success: true; payload: CashMovementPayload } | { success: false } {
  if (type === "CASH_EXPENSE") {
    const parsed = cashExpensePayloadSchema.safeParse(payload);
    if (!parsed.success) return { success: false };
    const data = parsed.data;
    return {
      success: true,
      payload: {
        movementId: data.movementId,
        sessionId: data.sessionId,
        amountCents: data.amountCents,
        category: data.category ?? null,
        description: data.description ?? null,
        reason: null,
        ownerAuthorizationId: data.ownerAuthorizationId ?? null,
        occurredAt: data.occurredAt
      }
    };
  }
  if (type === "CASH_WITHDRAWAL") {
    const parsed = cashWithdrawalPayloadSchema.safeParse(payload);
    if (!parsed.success) return { success: false };
    const data = parsed.data;
    return {
      success: true,
      payload: {
        movementId: data.movementId,
        sessionId: data.sessionId,
        amountCents: data.amountCents,
        category: null,
        description: null,
        reason: data.reason,
        ownerAuthorizationId: data.ownerAuthorizationId ?? null,
        occurredAt: data.occurredAt
      }
    };
  }
  if (type === "CASH_INJECTION") {
    const parsed = cashInjectionPayloadSchema.safeParse(payload);
    if (!parsed.success) return { success: false };
    const data = parsed.data;
    return {
      success: true,
      payload: {
        movementId: data.movementId,
        sessionId: data.sessionId,
        amountCents: data.amountCents,
        category: null,
        description: null,
        reason: data.reason,
        ownerAuthorizationId: data.ownerAuthorizationId ?? null,
        occurredAt: data.occurredAt
      }
    };
  }
  return { success: false };
}

function movementType(type: string): CashMovementType {
  if (type === "CASH_WITHDRAWAL") return "WITHDRAWAL";
  if (type === "CASH_INJECTION") return "INJECTION";
  return "EXPENSE";
}

function authorizationPurpose(type: string): string {
  if (type === "CASH_WITHDRAWAL") return "CASH_WITHDRAWAL";
  if (type === "CASH_INJECTION") return "CASH_INJECTION";
  return "CASH_EXPENSE";
}
