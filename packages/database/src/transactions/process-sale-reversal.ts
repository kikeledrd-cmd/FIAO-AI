import { saleReversalPayloadSchema, type SaleReversalPayload } from "@fiao/contracts/inventory";
import type { SalePayment } from "@fiao/contracts/sales";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { addDecimalQuantities } from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, isUniqueConstraintError, persistRejectedOperation } from "./shared";
import { isOwnerAuthorized } from "./process-stock-adjustment";

interface SaleLineRow {
  productId: string;
  quantity: string;
}

/**
 * Reverso (anulación) de una venta: restaura stock y revierte el cargo de
 * crédito si la venta fue a fiado.
 *
 * - Requiere rol OWNER o OwnerAuthorization válida (purpose SALE_REVERSAL
 *   ligada al operationId).
 * - Append-only: crea StockMovement tipo REVERSAL y CreditMovement tipo
 *   REVERSAL; la venta original nunca se modifica.
 * - Idempotente por operationId y por venta (no se puede revertir dos veces).
 */
export async function processSaleReversal(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = saleReversalPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const authorized = await isOwnerAuthorized(
    context,
    envelope,
    { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
    "SALE_REVERSAL",
    db
  );
  if (!authorized) {
    return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
  }

  const sale = await db.sale.findFirst({
    where: { saleId: payload.saleId, ownerId: context.ownerId, branchId: context.branchId },
    select: {
      id: true,
      saleId: true,
      customerId: true,
      lines: true,
      payments: true,
      totalCents: true
    }
  });
  if (!sale) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_SALE", db);
  }

  // La venta ya fue revertida (append-only): buscamos el syncChange REVERSAL.
  const alreadyReversed = await db.syncChange.findFirst({
    where: { ownerId: context.ownerId, branchId: context.branchId, type: "REVERSAL" },
    select: { payload: true }
  }).then((rows) => rows !== null ? isReversalForSale(rows.payload, payload.saleId) : false);
  if (alreadyReversed) {
    return persistRejectedOperation(context, envelope, "SALE_ALREADY_REVERSED", db);
  }

  const lines = parseSaleLines(sale.lines);
  const payments = parseSalePayments(sale.payments);
  const fiadoCents = fiadoTotalCents(payments);
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

      // Restaurar stock por línea.
      for (const line of lines) {
        const current = await tx.productStock.findUnique({
          where: { productId: line.productId },
          select: { onHand: true }
        });
        const onHand = current?.onHand ?? "0";
        const restored = addDecimalQuantities(onHand, line.quantity);
        await tx.productStock.upsert({
          where: { productId: line.productId },
          update: { onHand: restored },
          create: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            onHand: restored
          }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "REVERSAL",
            quantityDelta: `+${line.quantity}`,
            clientOperationId: operation.id
          }
        });
      }

      // Revertir el cargo de crédito si la venta fue a fiado.
      const customerPkId = sale.customerId;
      const customerPublicId = customerPkId
        ? (await tx.customer.findUnique({ where: { id: customerPkId }, select: { customerId: true } }))?.customerId
        : undefined;

      const reversalMovementId = crypto.randomUUID();
      if (fiadoCents > 0 && customerPublicId) {
        await tx.creditMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            customerId: customerPkId!,
            type: "REVERSAL",
            amountCents: fiadoCents,
            saleId: sale.id,
            clientOperationId: operation.id,
            occurredAt
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
          action: "SALE_REVERSAL_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { reversalId: payload.reversalId, saleId: sale.saleId, reason: payload.reason, fiadoReversedCents: fiadoCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "REVERSAL",
          payload: {
            reversalId: payload.reversalId,
            saleId: sale.saleId,
            lines,
            reason: payload.reason,
            fiadoReversedCents: fiadoCents,
            occurredAt: occurredAt.toISOString()
          } as never
        },
        select: { seq: true }
      });

      // Delta CREDIT para los clientes si hubo fiado revertido.
      if (fiadoCents > 0 && customerPublicId) {
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CREDIT",
            payload: {
              movementId: reversalMovementId,
              type: "REVERSAL",
              customerId: customerPublicId,
              amountCents: fiadoCents,
              saleId: sale.saleId,
              abonoId: null,
              occurredAt: occurredAt.toISOString()
            }
          },
          select: { seq: true }
        });
      }

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

function isReversalForSale(payload: unknown, saleId: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return record.saleId === saleId;
}

function parseSaleLines(value: unknown): SaleLineRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is Record<string, unknown> => typeof line === "object" && line !== null)
    .map((line) => ({
      productId: typeof line.productId === "string" ? line.productId : "",
      quantity: typeof line.quantity === "string" ? line.quantity : "0"
    }))
    .filter((line) => line.productId.length > 0 && line.quantity !== "0");
}

function parseSalePayments(value: unknown): SalePayment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((payment): payment is SalePayment =>
    typeof payment === "object" && payment !== null &&
    typeof (payment as SalePayment).method === "string" &&
    typeof (payment as SalePayment).amountCents === "number"
  );
}

function fiadoTotalCents(payments: SalePayment[]): number {
  return payments.reduce((sum, payment) => (payment.method === "FIADO" ? sum + payment.amountCents : sum), 0);
}
