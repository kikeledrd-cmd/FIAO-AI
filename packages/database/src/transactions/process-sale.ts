import { saleOperationPayloadSchema, type SaleOperationPayload } from "@fiao/contracts/sales";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  parseSaleQuantity,
  subtractDecimalQuantities,
  validateSale
} from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";

/**
 * Procesa una operación de venta de forma idempotente.
 *
 * - Validación de negocio (dominio) antes de escribir nada.
 * - Append-only: `Sale` (JSONB inmutable) + `StockMovement` por línea.
 * - `ProductStock` es proyección actualizada en la misma transacción.
 * - Rechazos se persisten como operación REJECTED sin syncChange, para que el
 *   cliente la vea como conflicto y no se replique.
 */
export async function processSaleOperation(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = saleOperationPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  let totals;
  try {
    totals = validateSale(payload.lines, payload.payments);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true, stockControl: true }
  });
  if (products.length !== productIds.length) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
  }
  const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));

  if (stockControlIds.size > 0) {
    const stockRows = await db.productStock.findMany({
      where: { ownerId: context.ownerId, branchId: context.branchId, productId: { in: [...stockControlIds] } },
      select: { productId: true, onHand: true }
    });
    const onHandByProduct = new Map(stockRows.map((row) => [row.productId, row.onHand]));
    for (const line of payload.lines) {
      if (!stockControlIds.has(line.productId)) continue;
      const onHand = onHandByProduct.get(line.productId);
      if (onHand === undefined) {
        return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
      }
      const requested = parseSaleQuantity(line.quantity).scaled;
      const available = parseSaleQuantity(onHand).scaled;
      if (requested > available) {
        return persistRejectedOperation(context, envelope, "STOCK_INSUFFICIENT", db);
      }
    }
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

      const sale = await tx.sale.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          saleId: payload.saleId,
          customerId: payload.customerId ?? null,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          lines: payload.lines as never,
          payments: payload.payments as never,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          occurredAt
        },
        select: { id: true, saleId: true }
      });

      const productById = new Map(products.map((product) => [product.id, product]));
      for (const line of payload.lines) {
        const product = productById.get(line.productId);
        if (!product?.stockControl) continue;
        const current = await tx.productStock.findUnique({
          where: { productId: line.productId },
          select: { onHand: true }
        });
        const onHand = current?.onHand ?? "0";
        await tx.productStock.upsert({
          where: { productId: line.productId },
          update: { onHand: subtractDecimalQuantities(onHand, line.quantity) },
          create: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            onHand: subtractDecimalQuantities(onHand, line.quantity)
          }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "SALE",
            quantityDelta: `-${line.quantity}`,
            clientOperationId: operation.id
          }
        });
      }

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "SALE_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { saleId: sale.saleId, totalCents: totals.totalCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "SALE",
          payload: saleChangePayload(payload, totals)
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

function saleChangePayload(payload: SaleOperationPayload, totals: { subtotalCents: number; totalCents: number }) {
  return {
    saleId: payload.saleId,
    customerId: payload.customerId ?? null,
    lines: payload.lines,
    payments: payload.payments,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents
  };
}

async function persistRejectedOperation(
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

function duplicateResult(
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
  return "INVALID_SALE";
}
