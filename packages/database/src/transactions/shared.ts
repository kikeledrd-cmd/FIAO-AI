import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { parseOperationTimestamp } from "@fiao/sync/operation";
import type { FiaoPrismaClient } from "../client";

/**
 * Persiste una operación rechazada sin syncChange (el cliente la ve como
 * conflicto y no se replica). Idempotente: si la operación ya tiene
 * resultado, devuelve el existente.
 */
export async function persistRejectedOperation(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  errorCode: string,
  db: FiaoPrismaClient
): Promise<OperationResult> {
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
      const persistedResult = {
        operationId: envelope.operationId,
        status: "REJECTED" as const,
        errorCode,
        latestCursor: "0"
      };
      await tx.clientOperation.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          operationId: envelope.operationId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          type: envelope.type,
          occurredAt,
          baseCursor: envelope.baseCursor === null ? null : BigInt(envelope.baseCursor),
          payload: envelope.payload as never,
          status: "REJECTED",
          latestCursor: 0n,
          result: persistedResult
        }
      });
      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "OPERATION_REJECTED",
          targetOperationId: envelope.operationId,
          payload: { type: envelope.type, errorCode }
        }
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

export function duplicateResult(
  operationId: string,
  status: string | null,
  result: unknown,
  latestCursor: bigint | null
): OperationResult {
  const stored = asStoredResult(result);
  return {
    operationId,
    status: (status === "REJECTED" ? "REJECTED" : status === "ACCEPTED_WITH_CONFLICT" ? "ACCEPTED_WITH_CONFLICT" : "ACCEPTED") as OperationResult["status"],
    ...(stored.conflictId ? { conflictId: stored.conflictId } : {}),
    ...(stored.errorCode ? { errorCode: stored.errorCode } : {}),
    latestCursor: (latestCursor ?? 0n).toString()
  };
}

export function asStoredResult(value: unknown): { conflictId?: string; errorCode?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  return {
    ...(typeof result.conflictId === "string" ? { conflictId: result.conflictId } : {}),
    ...(typeof result.errorCode === "string" ? { errorCode: result.errorCode } : {})
  };
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "INVALID_OPERATION";
}
