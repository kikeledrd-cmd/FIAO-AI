import { abonoPayloadSchema } from "@fiao/contracts/credit";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertAbonoValid, creditBalanceCents } from "@fiao/domain/credit/credit-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";

type TransactionClient = Parameters<Parameters<FiaoPrismaClient["$transaction"]>[0]>[0];

/**
 * Procesa ABONO de forma idempotente: descarga el saldo del cliente
 * creando un CreditMovement ABONO (append-only). Valida contra el saldo
 * real computado desde movimientos.
 */
export async function processAbonoOperation(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = abonoPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejected(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;
  const occurredAt = parseOperationTimestamp(payload.occurredAt ?? envelope.occurredAt);

  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (duplicate?.status && duplicate.latestCursor !== null) {
        return duplicateResult(duplicate);
      }

      const customer = await tx.customer.findUnique({
        where: { customerId: payload.customerId },
        select: { id: true }
      });
      if (!customer) return rejectInTransaction(tx, context, envelope, "UNKNOWN_CUSTOMER", occurredAt);

      const movements = await tx.creditMovement.findMany({
        where: { ownerId: context.ownerId, branchId: context.branchId, customerId: customer.id },
        select: { type: true, amountCents: true }
      });
      const balance = creditBalanceCents(movements);
      try {
        assertAbonoValid(balance, payload.amountCents);
      } catch (error) {
        return rejectInTransaction(tx, context, envelope, errorMessage(error), occurredAt);
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

      await tx.creditMovement.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          customerId: customer.id,
          type: "ABONO",
          amountCents: payload.amountCents,
          abonoId: payload.abonoId,
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
          action: "ABONO_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { customerId: payload.customerId, amountCents: payload.amountCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "CREDIT",
          payload: {
            movementId: crypto.randomUUID(),
            type: "ABONO",
            customerId: payload.customerId,
            amountCents: payload.amountCents,
            abonoId: payload.abonoId,
            saleId: null,
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
      if (existing?.status && existing.latestCursor !== null) return duplicateResult(existing);
    }
    throw error;
  }
}

async function rejectInTransaction(
  tx: TransactionClient,
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  errorCode: string,
  occurredAt: Date
): Promise<OperationResult> {
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
}

async function persistRejected(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  errorCode: string,
  db: TransactionClient
): Promise<OperationResult> {
  const occurredAt = parseOperationTimestamp(envelope.occurredAt);
  try {
    return await db.$transaction(async (tx) => {
      const duplicate = await tx.clientOperation.findUnique({
        where: { ownerId_operationId: { ownerId: context.ownerId, operationId: envelope.operationId } },
        select: { operationId: true, status: true, result: true, latestCursor: true }
      });
      if (duplicate?.status && duplicate.latestCursor !== null) return duplicateResult(duplicate);
      return rejectInTransaction(tx, context, envelope, errorCode, occurredAt);
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "INVALID_ABONO";
}
