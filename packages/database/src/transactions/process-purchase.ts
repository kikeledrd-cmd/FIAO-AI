import { purchasePayloadSchema, type PurchasePayload } from "@fiao/contracts/purchasing";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { assertPurchaseLineValid, computeMovingAverageCost } from "@fiao/domain/purchasing/purchase-policy";
import { addDecimalQuantities, parseSaleQuantity } from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";
import { isOwnerAuthorized } from "./process-stock-adjustment";

interface PurchaseProductRow {
  id: string;
  stockControl: boolean;
  costCents: number;
}

/**
 * Compra a proveedor (append-only).
 *
 * - Requiere rol OWNER o OwnerAuthorization válida (purpose PURCHASE ligada al
 *   operationId) cuando el actor es CASHIER (cambia el costo).
 * - Crea StockMovement tipo PURCHASE (+cantidad por línea) y actualiza
 *   Product.costCents con costo promedio móvil determinístico.
 */
export async function processPurchase(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = purchasePayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const authorized = await isOwnerAuthorized(
    context,
    envelope,
    { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
    "PURCHASE",
    db
  );
  if (!authorized) {
    return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
  }

  // Proveedor: opcional, pero si viene debe existir en la sucursal.
  let supplierPkId: string | null = null;
  if (payload.supplierId) {
    const supplier = await db.supplier.findUnique({
      where: { supplierId: payload.supplierId },
      select: { id: true, ownerId: true, branchId: true, active: true }
    });
    if (!supplier || supplier.ownerId !== context.ownerId || supplier.branchId !== context.branchId || !supplier.active) {
      return persistRejectedOperation(context, envelope, "UNKNOWN_SUPPLIER", db);
    }
    supplierPkId = supplier.id;
  }

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId, active: true },
    select: { id: true, stockControl: true, costCents: true }
  });
  if (products.length !== productIds.length) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
  }
  const productById = new Map(products.map((product) => [product.id, product]));

  // Validar líneas y calcular total.
  let totalCents = 0;
  const validatedLines: Array<{ productId: string; quantity: string; unitCostCents: number; lineTotalCents: number }> = [];
  for (const line of payload.lines) {
    const product = productById.get(line.productId);
    if (!product) return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
    try {
      assertPurchaseLineValid(line, product.stockControl);
    } catch (error) {
      return persistRejectedOperation(context, envelope, errorMessage(error), db);
    }
    const scaled = parseSaleQuantity(line.quantity).scaled;
    const lineTotalCents = Math.round(Number((BigInt(line.unitCostCents) * scaled) / 1000n));
    totalCents += lineTotalCents;
    validatedLines.push({ ...line, lineTotalCents });
  }

  const occurredAt = parseOperationTimestamp(payload.occurredAt);

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

      const purchase = await tx.purchase.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          purchaseId: payload.purchaseId,
          ...(supplierPkId ? { supplierId: supplierPkId } : {}),
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          note: payload.note ?? null,
          totalCents,
          occurredAt
        },
        select: { id: true, purchaseId: true }
      });

      // Por línea: StockMovement PURCHASE, ProductStock +qty, Product.costCents.
      const costUpdates: Array<{ productId: string; costCents: number }> = [];
      for (const line of validatedLines) {
        await tx.purchaseLine.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            purchaseId: purchase.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCostCents: line.unitCostCents,
            lineTotalCents: line.lineTotalCents
          }
        });

        const current = await tx.productStock.findUnique({
          where: { productId: line.productId },
          select: { onHand: true }
        });
        const onHand = current?.onHand ?? "0";
        const newOnHand = addQuantities(onHand, line.quantity);
        await tx.productStock.upsert({
          where: { productId: line.productId },
          update: { onHand: newOnHand },
          create: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            onHand: newOnHand
          }
        });
        await tx.stockMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            productId: line.productId,
            type: "PURCHASE",
            quantityDelta: `+${line.quantity}`,
            clientOperationId: operation.id
          }
        });

        const product = productById.get(line.productId)!;
        const newCost = computeMovingAverageCost(product.costCents, onHand, line.unitCostCents, line.quantity);
        await tx.product.update({
          where: { id: line.productId },
          data: { costCents: newCost }
        });
        costUpdates.push({ productId: line.productId, costCents: newCost });
      }

      await tx.auditEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
          source: "OFFLINE_SYNC",
          action: "PURCHASE_ACCEPTED",
          targetOperationId: envelope.operationId,
          payload: { purchaseId: payload.purchaseId, totalCents, lineCount: validatedLines.length }
        }
      });

      const change = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "PURCHASE",
          payload: {
            purchaseId: payload.purchaseId,
            supplierId: payload.supplierId ?? null,
            lines: validatedLines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitCostCents: line.unitCostCents })),
            costAfter: costUpdates,
            note: payload.note ?? null,
            totalCents,
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
      if (existing?.status && existing.latestCursor !== null) {
        return duplicateResult(existing.operationId, existing.status, existing.result, existing.latestCursor);
      }
    }
    throw error;
  }
}

function addQuantities(left: string, right: string): string {
  if (/^0+(\.0+)?$/.test(left)) return normalizeQuantity(right);
  return addDecimalQuantities(left, right);
}

function normalizeQuantity(value: string): string {
  const parsed = parseSaleQuantity(value).scaled;
  const whole = parsed / 1000n;
  const fraction = (parsed % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
