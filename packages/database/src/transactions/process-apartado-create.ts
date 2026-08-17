import {
  apartadoCreatePayloadSchema,
  type ApartadoCreatePayload
} from "@fiao/contracts/apartado";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  addReservation,
  assertApartadoCreateValid,
  type ApartadoStockLine
} from "@fiao/domain/apartado/apartado-policy";
import { saleLineTotalCents } from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Crea un apartado: valida líneas contra el stock disponible (onHand −
 * reserved), reserva inventario (reserved += qty) y registra el anticipo en
 * caja como INJECTION (el efectivo físico entra a la caja; al completar la
 * venta, el anticipo se paga con el método APARTADO_CREDIT para no contarlo
 * dos veces en el esperado).
 *
 * - Requiere sesión de caja abierta (el anticipo es efectivo físico).
 * - El cajero puede crear apartados sin autorización de OWNER (la
 *   cancelación sí exige PIN).
 * - Append-only + idempotente por operationId.
 */
export async function processApartadoCreate(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = apartadoCreatePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const customer = await db.customer.findFirst({
    where: { customerId: payload.customerId, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true }
  });
  if (!customer) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_CUSTOMER", db);
  }

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true, stockControl: true }
  });
  if (products.length !== productIds.length) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
  }
  const stockControlById = new Map(products.map((product) => [product.id, product.stockControl]));
  const stockRows = await db.productStock.findMany({
    where: { ownerId: context.ownerId, branchId: context.branchId, productId: { in: productIds } },
    select: { productId: true, onHand: true, reserved: true }
  });
  const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));

  const lines: ApartadoStockLine[] = payload.lines.map((line) => {
    const stock = stockByProduct.get(line.productId);
    const stockControl = stockControlById.get(line.productId) ?? false;
    return {
      productId: line.productId,
      quantity: line.quantity,
      priceCents: line.priceCents,
      onHand: stockControl ? (stock?.onHand ?? "0") : "999999",
      reserved: stockControl ? (stock?.reserved ?? "0") : "0"
    };
  });

  const totalFromLines = payload.lines.reduce(
    (sum, line) => sum + saleLineTotalCents(line.priceCents, line.quantity),
    0
  );
  if (totalFromLines !== payload.totalCents) {
    return persistRejectedOperation(context, envelope, "TOTAL_MISMATCH", db);
  }

  try {
    assertApartadoCreateValid({ lines, depositCents: payload.depositCents, totalCents: payload.totalCents });
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
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

      const sessionRow = await tx.cashSession.findFirst({
        where: { ownerId: context.ownerId, branchId: context.branchId, status: "OPEN" },
        select: { id: true }
      });
      if (!sessionRow) {
        throw new Error("CASH_SESSION_REQUIRED");
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

      const apartado = await tx.apartado.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          apartadoId: payload.apartadoId,
          customerId: customer.id,
          status: "ACTIVE",
          depositCents: payload.depositCents,
          totalCents: payload.totalCents,
          ...(payload.promiseDate ? { promiseDate: new Date(payload.promiseDate) } : {}),
          ...(payload.notes ? { notes: payload.notes } : {}),
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          occurredAt
        },
        select: { id: true, apartadoId: true }
      });

      for (const line of payload.lines) {
        const stock = stockByProduct.get(line.productId);
        await tx.apartadoLine.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            apartadoId: apartado.id,
            productId: line.productId,
            quantity: line.quantity,
            priceCents: line.priceCents,
            lineTotalCents: saleLineTotalCents(line.priceCents, line.quantity)
          }
        });
        if (!(stockControlById.get(line.productId) ?? false)) continue;
        const reserved = stock?.reserved ?? "0";
        await tx.productStock.update({
          where: { productId: line.productId },
          data: { reserved: addReservation(reserved, line.quantity) }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "RESERVATION",
            quantityDelta: `+${line.quantity}`,
            clientOperationId: operation.id
          }
        });
      }

      // Anticipo entra a caja (efectivo físico).
      if (payload.depositCents > 0) {
        await tx.cashMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            sessionId: sessionRow.id,
            movementId: crypto.randomUUID(),
            type: "INJECTION",
            amountCents: payload.depositCents,
            category: "APARTADO_DEPOSIT",
            description: `Anticipo de apartado ${apartado.apartadoId}`,
            reason: null,
            actorUserId: context.userId,
            deviceId: context.deviceId,
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
          action: "APARTADO_CREATED",
          targetOperationId: envelope.operationId,
          payload: { apartadoId: apartado.apartadoId, totalCents: payload.totalCents, depositCents: payload.depositCents }
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
            customerId: payload.customerId,
            status: "ACTIVE",
            lines: payload.lines,
            depositCents: payload.depositCents,
            totalCents: payload.totalCents,
            promiseDate: payload.promiseDate ?? null,
            notes: payload.notes ?? null,
            occurredAt: occurredAt.toISOString()
          }
        },
        select: { seq: true }
      });

      // Delta CASH del anticipo para el esperado local.
      if (payload.depositCents > 0) {
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CASH_INJECTION",
            payload: {
              movementId: crypto.randomUUID(),
              sessionId: null,
              type: "INJECTION",
              amountCents: payload.depositCents,
              category: "APARTADO_DEPOSIT",
              description: `Anticipo de apartado ${apartado.apartadoId}`,
              reason: null,
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
    if (error instanceof Error && error.message === "CASH_SESSION_REQUIRED") {
      return persistRejectedOperation(context, envelope, "CASH_SESSION_REQUIRED", db);
    }
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
