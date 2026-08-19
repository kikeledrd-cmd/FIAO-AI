import { orderDeliverPayloadSchema, type OrderDeliverPayload } from "@fiao/contracts/orders";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { SalePayment } from "@fiao/contracts/sales";
import type { CommandContext } from "@fiao/domain/context";
import { assertCreditLimit, creditBalanceCents } from "@fiao/domain/credit/credit-policy";
import {
  computePointsEarned,
  loyaltyExpiresAt
} from "@fiao/domain/loyalty/loyalty-policy";
import { assertOrderTransitionValid } from "@fiao/domain/orders/order-policy";
import {
  parseSaleQuantity,
  subtractDecimalQuantities,
  validateSale
} from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { isOwnerAuthorized } from "./process-stock-adjustment";
import {
  findOrderByOrderId,
  orderSubtotalCents,
  releaseStockForOrder
} from "./order-shared";
import { duplicateResult, errorMessage, isUniqueConstraintError, persistRejectedOperation } from "./shared";

/**
 * Entrega un pedido (ON_THE_WAY → DELIVERED): finaliza la venta exactamente
 * una vez. Crea la Sale con las líneas del pedido y los pagos recibidos,
 * decrementa el stock (SALE) y libera la reserva (reserved −= qty), registra
 * el cargo FIADO y la ganancia de lealtad. El efectivo se computa del
 * Sale.payments (método CASH), igual que el resto del sistema.
 *
 * - El total de la venta es el subtotal de las líneas (el deliveryFee no se
 *   materializa como venta en V1).
 * - Idempotente por operationId: el pedido solo puede entregarse una vez.
 */
export async function processOrderDeliver(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  assertOperationScope(context, envelope);

  const parsed = orderDeliverPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return persistRejectedOperation(context, envelope, "INVALID_PAYLOAD", db);
  }
  const payload = parsed.data;

  const order = await findOrderByOrderId(db, context, payload.orderId);
  if (!order) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_ORDER", db);
  }
  try {
    assertOrderTransitionValid(order.status as never, "DELIVERED");
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const authorized = await isOwnerAuthorized(
    context,
    envelope,
    { ownerAuthorizationId: payload.ownerAuthorizationId ?? null },
    "ORDER_DELIVER",
    db
  );
  if (!authorized) {
    return persistRejectedOperation(context, envelope, "OWNER_AUTHORIZATION_REQUIRED", db);
  }

  let totals;
  try {
    totals = validateSale(order.lines, payload.payments);
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  // Fiado: requiere cliente y límite.
  const fiadoCents = fiadoTotalCents(payload.payments);
  const customerForCredit =
    fiadoCents > 0 ? await loadCustomerWithBalance(context, order.customerId, db) : null;
  if (fiadoCents > 0 && order.customerId === null) {
    return persistRejectedOperation(context, envelope, "FIADO_REQUIRES_CUSTOMER", db);
  }
  if (fiadoCents > 0 && customerForCredit === null) {
    return persistRejectedOperation(context, envelope, "UNKNOWN_CUSTOMER", db);
  }
  if (fiadoCents > 0 && customerForCredit) {
    try {
      assertCreditLimit(customerForCredit.balanceCents, fiadoCents, customerForCredit.creditLimitCents);
    } catch (error) {
      return persistRejectedOperation(context, envelope, errorMessage(error), db);
    }
  }

  // Stock suficiente al momento de entregar.
  const productIds = [...new Set(order.lines.map((line) => line.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true, stockControl: true }
  });
  const stockControlIds = new Set(products.filter((product) => product.stockControl).map((product) => product.id));
  if (stockControlIds.size > 0) {
    const stockRows = await db.productStock.findMany({
      where: { ownerId: context.ownerId, branchId: context.branchId, productId: { in: [...stockControlIds] } },
      select: { productId: true, onHand: true }
    });
    const onHandByProduct = new Map(stockRows.map((row) => [row.productId, row.onHand]));
    for (const line of order.lines) {
      if (!stockControlIds.has(line.productId)) continue;
      const onHand = onHandByProduct.get(line.productId);
      if (onHand === undefined) {
        return persistRejectedOperation(context, envelope, "UNKNOWN_PRODUCT", db);
      }
      if (parseSaleQuantity(line.quantity).scaled > parseSaleQuantity(onHand).scaled) {
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

      // 1) Libera la reserva del pedido (reserved −= qty).
      await releaseStockForOrder(tx, context, operation.id, order.lines);

      // 2) Crea la venta final.
      const sale = await tx.sale.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          saleId: crypto.randomUUID(),
          ...(order.customerId ? { customerId: order.customerId } : {}),
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          lines: order.lines as never,
          payments: payload.payments as never,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          occurredAt
        },
        select: { id: true, saleId: true }
      });

      // 3) Decrementa stock (SALE).
      for (const line of order.lines) {
        if (!stockControlIds.has(line.productId)) continue;
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

      // 4) Cargo FIADO.
      if (fiadoCents > 0 && order.customerId) {
        await tx.creditMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            customerId: order.customerId,
            type: "FIAO_SALE",
            amountCents: fiadoCents,
            saleId: sale.id,
            clientOperationId: operation.id,
            occurredAt
          }
        });
      }

      // 5) Lealtad: ganancia de puntos si hay cliente.
      const customerPublicId = order.customerId
        ? (await tx.customer.findUnique({ where: { id: order.customerId }, select: { customerId: true } }))?.customerId ?? null
        : null;
      if (customerPublicId) {
        const config = await tx.loyaltyConfig.findUnique({
          where: { ownerId: context.ownerId },
          select: { enabled: true, pointsPerHundredCents: true, expiryDays: true }
        });
        if (config?.enabled !== false && totals.totalCents > 0) {
          const points = computePointsEarned(totals.totalCents, config?.pointsPerHundredCents ?? 100);
          if (points > 0) {
            const movementId = crypto.randomUUID();
            const expiresAt = loyaltyExpiresAt(occurredAt.toISOString(), config?.expiryDays ?? 180);
            await tx.loyaltyMovement.create({
              data: {
                ownerId: context.ownerId,
                branchId: context.branchId,
                customerId: order.customerId!,
                movementId,
                type: "EARN",
                pointsDelta: points,
                saleId: sale.id,
                rewardId: null,
                reason: null,
                expiresAt: new Date(expiresAt),
                clientOperationId: operation.id,
                occurredAt
              }
            });
            await tx.syncChange.create({
              data: {
                ownerId: context.ownerId,
                branchId: context.branchId,
                clientOperationId: operation.id,
                type: "LOYALTY",
                payload: {
                  movementId,
                  type: "EARN",
                  customerId: customerPublicId,
                  pointsDelta: points,
                  rewardId: null,
                  saleId: sale.saleId,
                  expiresAt,
                  occurredAt: occurredAt.toISOString()
                } as never
              },
              select: { seq: true }
            });
          }
        }
      }

      // 6) Marca el pedido entregado.
      await tx.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", saleId: sale.id }
      });
      await tx.orderTimelineEvent.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          orderId: order.id,
          status: "DELIVERED",
          actorUserId: context.userId,
          note: null,
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
          action: "ORDER_DELIVERED",
          targetOperationId: envelope.operationId,
          payload: { orderId: order.orderId, saleId: sale.saleId, totalCents: totals.totalCents }
        }
      });

      // Sync changes: SALE (venta + efectivo), CREDIT (fiado) y ORDER (estado).
      const saleChange = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "SALE",
          payload: {
            saleId: sale.saleId,
            customerId: customerPublicId,
            lines: order.lines,
            payments: payload.payments,
            subtotalCents: totals.subtotalCents,
            totalCents: totals.totalCents
          } as never
        },
        select: { seq: true }
      });
      let latestSeq = saleChange.seq;

      if (fiadoCents > 0 && customerPublicId) {
        const creditChange = await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CREDIT",
            payload: {
              movementId: crypto.randomUUID(),
              type: "FIAO_SALE",
              customerId: customerPublicId,
              amountCents: fiadoCents,
              saleId: sale.saleId,
              abonoId: null,
              occurredAt: occurredAt.toISOString()
            } as never
          },
          select: { seq: true }
        });
        latestSeq = creditChange.seq;
      }

      const orderChange = await tx.syncChange.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          clientOperationId: operation.id,
          type: "ORDER",
          payload: {
            orderId: order.orderId,
            status: "DELIVERED",
            saleId: sale.saleId,
            occurredAt: occurredAt.toISOString()
          } as never
        },
        select: { seq: true }
      });
      latestSeq = orderChange.seq;

      const persistedResult = {
        operationId: envelope.operationId,
        status: "ACCEPTED" as const,
        latestCursor: latestSeq.toString()
      };
      await tx.clientOperation.update({
        where: { id: operation.id },
        data: { status: "ACCEPTED", latestCursor: latestSeq, result: persistedResult }
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

function fiadoTotalCents(payments: SalePayment[]): number {
  return payments.reduce((sum, payment) => (payment.method === "FIADO" ? sum + payment.amountCents : sum), 0);
}

async function loadCustomerWithBalance(
  context: CommandContext,
  customerPkId: string | null,
  db: FiaoPrismaClient
): Promise<{ creditLimitCents: number; balanceCents: number } | null> {
  if (!customerPkId) return null;
  const customer = await db.customer.findUnique({
    where: { id: customerPkId },
    select: { id: true, creditLimitCents: true, ownerId: true, branchId: true }
  });
  if (!customer || customer.ownerId !== context.ownerId || customer.branchId !== context.branchId) return null;
  const movements = await db.creditMovement.findMany({
    where: { ownerId: context.ownerId, branchId: context.branchId, customerId: customer.id },
    select: { type: true, amountCents: true }
  });
  return { creditLimitCents: customer.creditLimitCents, balanceCents: creditBalanceCents(movements) };
}
