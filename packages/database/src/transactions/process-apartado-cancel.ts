import {
  apartadoCancelPayloadSchema
} from "@fiao/contracts/apartado";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertApartadoTransitionValid,
  releaseReservation
} from "@fiao/domain/apartado/apartado-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { isOwnerAuthorized } from "./process-stock-adjustment";
import { duplicateResult, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Cancelar un apartado: libera la reserva (reserved −= qty), devuelve el
 * anticipo como crédito a favor del cliente (CreditMovement APARTADO_REFUND)
 * y saca el efectivo de caja (CashMovement WITHDRAWAL con razón documentada).
 *
 * - El cajero necesita autorización de OWNER (purpose APARTADO_CANCEL);
 *   el rol OWNER pasa directo.
 * - Append-only + idempotente por operationId.
 */
export async function processApartadoCancel(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = apartadoCancelPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const authorized = await isOwnerAuthorized(
    context,
    envelope,
    { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
    "APARTADO_CANCEL",
    db
  );
  if (!authorized) {
    return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
  }

  const apartado = await db.apartado.findFirst({
    where: { apartadoId: payload.apartadoId, ownerId: context.ownerId, branchId: context.branchId },
    select: {
      id: true,
      apartadoId: true,
      customerId: true,
      status: true,
      depositCents: true,
      lines: { select: { productId: true, quantity: true } }
    }
  });
  if (!apartado) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_APARTADO", db);
  }
  if (apartado.status !== "ACTIVE") {
    return persistRejectedOperation(context, envelope, "APARTADO_NOT_ACTIVE", db);
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

      assertApartadoTransitionValid("ACTIVE", "CANCELLED");

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

      await tx.apartado.update({
        where: { id: apartado.id },
        data: { status: "CANCELLED", cancelledAt: occurredAt }
      });

      // Liberar reservas.
      const products = await tx.product.findMany({
        where: { id: { in: apartado.lines.map((line) => line.productId) } },
        select: { id: true, stockControl: true }
      });
      const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));

      for (const line of apartado.lines) {
        if (!stockControlIds.has(line.productId)) continue;
        const current = await tx.productStock.findUnique({
          where: { productId: line.productId },
          select: { reserved: true }
        });
        const reserved = current?.reserved ?? "0";
        await tx.productStock.update({
          where: { productId: line.productId },
          data: { reserved: releaseReservation(reserved, line.quantity) }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "RESERVATION_RELEASE",
            quantityDelta: `-${line.quantity}`,
            clientOperationId: operation.id
          }
        });
      }

      // Reembolso del anticipo: crédito a favor + salida de caja.
      const refundMovementId = crypto.randomUUID();
      if (apartado.depositCents > 0) {
        await tx.creditMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            customerId: apartado.customerId,
            type: "APARTADO_REFUND",
            amountCents: apartado.depositCents,
            clientOperationId: operation.id,
            occurredAt
          }
        });

        const sessionRow = await tx.cashSession.findFirst({
          where: { ownerId: context.ownerId, branchId: context.branchId, status: "OPEN" },
          select: { id: true }
        });
        if (sessionRow) {
          await tx.cashMovement.create({
            data: {
              ownerId: context.ownerId,
              branchId: context.branchId,
              sessionId: sessionRow.id,
              movementId: crypto.randomUUID(),
              type: "WITHDRAWAL",
              amountCents: apartado.depositCents,
              category: "APARTADO_REFUND",
              description: null,
              reason: `Devolución de anticipo por cancelación de apartado ${apartado.apartadoId}: ${payload.reason}`,
              actorUserId: context.userId,
              deviceId: context.deviceId,
              clientOperationId: operation.id,
              occurredAt
            }
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "APARTADO_CANCELLED",
          targetOperationId: envelope.operationId,
          payload: { apartadoId: apartado.apartadoId, reason: payload.reason, refundCents: apartado.depositCents }
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
            status: "CANCELLED",
            lines: apartado.lines,
            reason: payload.reason,
            occurredAt: occurredAt.toISOString()
          }
        },
        select: { seq: true }
      });

      if (apartado.depositCents > 0) {
        // Delta CREDIT (reembolso como descargo) para el balance local.
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CREDIT",
            payload: {
              movementId: refundMovementId,
              type: "APARTADO_REFUND",
              customerId: apartado.customerId,
              amountCents: apartado.depositCents,
              saleId: null,
              abonoId: null,
              occurredAt: occurredAt.toISOString()
            }
          },
          select: { seq: true }
        });
        // Delta CASH (retiro) para el esperado local.
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CASH_WITHDRAWAL",
            payload: {
              movementId: crypto.randomUUID(),
              sessionId: null,
              type: "WITHDRAWAL",
              amountCents: apartado.depositCents,
              category: "APARTADO_REFUND",
              description: null,
              reason: `Devolución de anticipo por cancelación de apartado ${apartado.apartadoId}`,
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
