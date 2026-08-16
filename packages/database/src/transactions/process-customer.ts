import { customerUpsertPayloadSchema, type CustomerUpsertPayload } from "@fiao/contracts/credit";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";

/**
 * Procesa CUSTOMER_UPSERT de forma idempotente.
 * Crea o actualiza el cliente por `customerId` (dedup del dispositivo).
 */
export async function processCustomerUpsert(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = customerUpsertPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejected(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;
  if (payload.ownerId !== context.ownerId || payload.branchId !== context.branchId) {
    return persistRejected(context, envelope, "FORBIDDEN_SCOPE", db);
  }

  const occurredAt = parseOperationTimestamp(envelope.occurredAt);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (duplicate?.status && duplicate.latestCursor !== null) {
        return duplicateResult(duplicate);
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

      const existing = await tx.customer.findUnique({ where: { customerId: payload.customerId } });
      const customer = await tx.customer.upsert({
        where: { customerId: payload.customerId },
        update: {
          name: payload.name,
          phoneE164: payload.phoneE164 ?? null,
          creditLimitCents: payload.creditLimitCents,
          defaultPromiseDays: payload.defaultPromiseDays,
          active: payload.active
        },
        create: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          customerId: payload.customerId,
          name: payload.name,
          phoneE164: payload.phoneE164 ?? null,
          creditLimitCents: payload.creditLimitCents,
          defaultPromiseDays: payload.defaultPromiseDays,
          active: payload.active
        },
        select: { id: true, customerId: true }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: existing ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED",
          targetOperationId: envelope.operationId,
          payload: { customerId: customer.customerId }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "CUSTOMER",
          payload: customerChangePayload(payload)
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
      if (existing?.status && existing.latestCursor !== null) return duplicateResult(existing);
    }
    throw error;
  }
}

function customerChangePayload(payload: CustomerUpsertPayload) {
  return {
    customerId: payload.customerId,
    name: payload.name,
    phoneE164: payload.phoneE164 ?? null,
    creditLimitCents: payload.creditLimitCents,
    defaultPromiseDays: payload.defaultPromiseDays,
    active: payload.active
  };
}

async function persistRejected(
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
      if (duplicate?.status && duplicate.latestCursor !== null) return duplicateResult(duplicate);
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
      if (existing?.status && existing.latestCursor !== null) return duplicateResult(existing);
    }
    throw error;
  }
}

function duplicateResult(duplicate: { operationId: string; status: string | null; result: unknown; latestCursor: bigint | null }): OperationResult {
  const stored = asStoredResult(duplicate.result);
  return {
    operationId: duplicate.operationId,
    status: (duplicate.status === "REJECTED" ? "REJECTED" : duplicate.status === "ACCEPTED_WITH_CONFLICT" ? "ACCEPTED_WITH_CONFLICT" : "ACCEPTED") as OperationResult["status"],
    ...(stored.conflictId ? { conflictId: stored.conflictId } : {}),
    ...(stored.errorCode ? { errorCode: stored.errorCode } : {}),
    latestCursor: (duplicate.latestCursor ?? 0n).toString()
  };
}

function asStoredResult(value: unknown): { conflictId?: string; errorCode?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  return {
    ...(typeof result.conflictId === "string" ? { conflictId: result.conflictId } : {}),
    ...(typeof result.errorCode === "string" ? { errorCode: result.errorCode } : {})
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
