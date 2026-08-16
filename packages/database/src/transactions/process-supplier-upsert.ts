import { supplierUpsertPayloadSchema, type SupplierUpsertPayload } from "@fiao/contracts/purchasing";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Alta/edición de proveedor (datos maestros, idempotente por supplierId).
 * No requiere autorización de OWNER (como CUSTOMER_UPSERT).
 */
export async function processSupplierUpsert(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = supplierUpsertPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  if (payload.ownerId !== context.ownerId || payload.branchId !== context.branchId) {
    return persistRejectedOperation(context, envelope, "FORBIDDEN_SCOPE", db);
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

      await tx.supplier.upsert({
        where: { supplierId: payload.supplierId },
        update: {
          name: payload.name,
          ...(payload.phoneE164 === null || payload.phoneE164 === undefined ? {} : { phoneE164: payload.phoneE164 }),
          ...(typeof payload.active === "boolean" ? { active: payload.active } : {})
        },
        create: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          supplierId: payload.supplierId,
          name: payload.name,
          phoneE164: payload.phoneE164 ?? null,
          active: payload.active
        }
      });

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "SUPPLIER_UPSERT_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { supplierId: payload.supplierId, name: payload.name }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "SUPPLIER",
          payload: {
            supplierId: payload.supplierId,
            name: payload.name,
            phoneE164: payload.phoneE164 ?? null,
            active: payload.active
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
