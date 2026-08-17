import {
  apartadoCompletePayloadSchema
} from "@fiao/contracts/apartado";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { SalePayment } from "@fiao/contracts/sales";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertApartadoTransitionValid,
  releaseReservation
} from "@fiao/domain/apartado/apartado-policy";
import {
  paymentTotalCents,
  subtractDecimalQuantities,
  validateSale
} from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Completar un apartado: consume la reserva (onHand −= qty y reserved −= qty)
 * y crea la venta real. El anticipo ya entró a caja al crear el apartado
 * (INJECTION APARTADO_DEPOSIT), por lo que el pago del anticipo viaja con el
 * método APARTADO_CREDIT (no cuenta como efectivo) y el resto con el método
 * elegido por el cajero.
 *
 * - El cajero puede completar sin autorización de OWNER.
 * - Append-only + idempotente por operationId.
 */
export async function processApartadoComplete(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = apartadoCompletePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const apartado = await db.apartado.findFirst({
    where: { apartadoId: payload.apartadoId, ownerId: context.ownerId, branchId: context.branchId },
    select: {
      id: true,
      apartadoId: true,
      customerId: true,
      status: true,
      depositCents: true,
      totalCents: true,
      lines: { select: { productId: true, quantity: true, priceCents: true, lineTotalCents: true } }
    }
  });
  if (!apartado) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_APARTADO", db);
  }
  if (apartado.status !== "ACTIVE") {
    return persistRejectedOperation(context, envelope, "APARTADO_NOT_ACTIVE", db);
  }

  const remainder = paymentTotalCents(payload.remainderPayments);
  if (apartado.depositCents + remainder !== apartado.totalCents) {
    return persistRejectedOperation(context, envelope, "REMAINDER_MISMATCH", db);
  }

  const lines = apartado.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    priceCents: line.priceCents
  }));
  const payments: SalePayment[] = [
    { method: "APARTADO_CREDIT", amountCents: apartado.depositCents },
    ...payload.remainderPayments
  ];

  let totals;
  try {
    totals = validateSale(lines, payments);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const saleId = crypto.randomUUID();
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

      assertApartadoTransitionValid("ACTIVE", "COMPLETED");

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

      // Productos con control de stock para decidir el manejo de inventario.
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((line) => line.productId) } },
        select: { id: true, stockControl: true }
      });
      const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));

      const sale = await tx.sale.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          saleId,
          customerId: apartado.customerId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          lines: lines as never,
          payments: payments as never,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          apartadoId: apartado.id,
          occurredAt
        },
        select: { id: true, saleId: true }
      });

      await tx.apartado.update({
        where: { id: apartado.id },
        data: { status: "COMPLETED", completedAt: occurredAt }
      });

      // Consumir reserva: onHand −= qty, reserved −= qty.
      for (const line of lines) {
        if (!stockControlIds.has(line.productId)) continue;
        const current = await tx.productStock.findUnique({
          where: { productId: line.productId },
          select: { onHand: true, reserved: true }
        });
        const onHand = current?.onHand ?? "0";
        const reserved = current?.reserved ?? "0";
        await tx.productStock.update({
          where: { productId: line.productId },
          data: {
            onHand: subtractDecimalQuantities(onHand === "0" ? "0" : onHand, line.quantity),
            reserved: releaseReservation(reserved, line.quantity)
          }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "APARTADO_COMPLETE",
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
          action: "APARTADO_COMPLETED",
          targetOperationId: envelope.operationId,
          payload: { apartadoId: apartado.apartadoId, saleId, totalCents: totals.totalCents }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "APARTADO",
          payload: {
            apartadoId: apartado.apartadoId,
            customerId: null,
            status: "COMPLETED",
            lines,
            saleId,
            occurredAt: occurredAt.toISOString()
          }
        },
        select: { seq: true }
      });

      // Delta SALE para el ledger local (el esperado cuenta solo los CASH).
      await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "SALE",
          payload: {
            saleId,
            customerId: null,
            lines,
            payments,
            subtotalCents: totals.subtotalCents,
            totalCents: totals.totalCents,
            apartadoId: apartado.apartadoId
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
