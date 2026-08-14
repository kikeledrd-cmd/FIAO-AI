import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertOperationScope,
  isFoundationOperationType,
  normalizeJsonPayload,
  parseCursor,
  parseOperationTimestamp
} from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { SyncRepository } from "../repositories/sync-repository";

export async function processOperation(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);
  if (!isFoundationOperationType(envelope.type)) throw new Error("UNKNOWN_OPERATION_TYPE");

  const occurredAt = parseOperationTimestamp(envelope.occurredAt);
  const baseCursor = parseCursor(envelope.baseCursor);
  const payload = normalizeJsonPayload(envelope.payload);
  const repository = new SyncRepository(db);
  const existing = await repository.findOperationResult(context.ownerId, envelope.operationId);
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (duplicate?.status && duplicate.latestCursor !== null) {
        const duplicateResult = asStoredResult(duplicate.result);
        return {
          operationId: duplicate.operationId,
          status: duplicate.status,
          ...(duplicateResult.conflictId ? { conflictId: duplicateResult.conflictId } : {}),
          ...(duplicateResult.errorCode ? { errorCode: duplicateResult.errorCode } : {}),
          latestCursor: duplicate.latestCursor.toString()
        } satisfies OperationResult;
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
          baseCursor,
          payload: payload as never
        },
        select: { id: true }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "OPERATION_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { type: envelope.type }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: envelope.type,
          payload: { operationId: envelope.operationId, type: envelope.type }
        },
        select: { seq: true }
      });

      const persistedResult = {
        operationId: envelope.operationId,
        status: "ACCEPTED" as const,
        latestCursor: change.seq.toString()
      };
      const result: OperationResult = persistedResult;

      await tx.clientOperation.update({
        where: { id: operation.id },
        data: {
          status: "ACCEPTED",
          latestCursor: change.seq,
          result: persistedResult
        }
      });

      return result;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await repository.findOperationResult(context.ownerId, envelope.operationId);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

function asStoredResult(value: unknown): { conflictId?: string; errorCode?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  return {
    ...(typeof result.conflictId === "string" ? { conflictId: result.conflictId } : {}),
    ...(typeof result.errorCode === "string" ? { errorCode: result.errorCode } : {})
  };
}
