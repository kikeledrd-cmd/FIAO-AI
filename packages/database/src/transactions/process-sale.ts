import { saleOperationPayloadSchema, type SaleOperationPayload, type SalePayment } from "@fiao/contracts/sales";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import {
  assertCreditLimit,
  creditBalanceCents
} from "@fiao/domain/credit/credit-policy";
import {
  applyPromotions,
  type PromotionInput
} from "@fiao/domain/promotions/promotion-policy";
import {
  assertRedemptionAllowed,
  computeLoyaltyBalance,
  computePointsEarned,
  loyaltyExpiresAt
} from "@fiao/domain/loyalty/loyalty-policy";
import {
  parseSaleQuantity,
  subtotalCents,
  subtractDecimalQuantities,
  validateSale
} from "@fiao/domain/sales/sale-policy";
import { assertOperationScope, parseOperationTimestamp } from "@fiao/sync/operation";
import { databaseClient, type FiaoPrismaClient } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { LoyaltyMovementType } from "@fiao/domain/loyalty/loyalty-policy";

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

  // Redención de lealtad primero: recompensa activa + saldo suficiente.
  const rewardCheck = payload.reward
    ? await validateRedemption(context, payload, discountCentsFor(payload), db)
    : null;
  if (payload.reward && rewardCheck === null) {
    return persistRejectedOperation(context, envelope, "INVALID_REWARD", db);
  }

  // Promos: recompute determinístico del lado del servidor (spec §8).
  // El descuento de la redención se separa del reclamado por promos.
  const discountCents = payload.discountCents ?? 0;
  const promoDiscount = await validatePromotions(
    context,
    envelope,
    payload,
    discountCents - (rewardCheck?.discountCents ?? 0),
    db
  );
  if (promoDiscount === null) {
    return persistRejectedOperation(context, envelope, "PROMOTION_MISMATCH", db);
  }

  let totals;
  try {
    totals = validateSale(payload.lines, payload.payments, { discountCents });
  } catch (error) {
    return persistRejectedOperation(context, envelope, errorMessage(error), db);
  }

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];

  // Crédito: si hay pagos FIADO, debe existir cliente y respetar el límite.
  const fiadoCents = fiadoTotalCents(payload.payments);
  if (fiadoCents > 0 && payload.customerId === undefined) {
    return persistRejectedOperation(context, envelope, "FIADO_REQUIRES_CUSTOMER", db);
  }
  const customerForCredit = fiadoCents > 0 ? await loadCustomerWithBalance(context, payload.customerId!, db) : null;
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

      // Crédito: si hay pagos FIADO, resolver la PK interna del cliente para
      // los FK (Sale.customerId y CreditMovement.customerId apuntan a Customer.id).
      // También se resuelve para lealtad (puntos/recompensas) aunque no haya FIADO.
      let customerPkId: string | null = null;
      if (payload.customerId) {
        const customerRow = await tx.customer.findUnique({
          where: { customerId: payload.customerId },
          select: { id: true }
        });
        if (!customerRow) {
          throw new Error("UNKNOWN_CUSTOMER");
        }
        customerPkId = customerRow.id;
      }

      const sale = await tx.sale.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          saleId: payload.saleId,
          ...(customerPkId ? { customerId: customerPkId } : {}),
          actorUserId: context.userId,
          deviceId: context.deviceId,
          clientOperationId: operation.id,
          lines: payload.lines as never,
          payments: payload.payments as never,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          ...(discountCents > 0 ? { discountCents } : {}),
          ...(payload.promotionIds && payload.promotionIds.length > 0 ? { promotionIds: payload.promotionIds as never } : {}),
          ...(payload.reward ? { reward: payload.reward as never } : {}),
          occurredAt
        },
        select: { id: true, saleId: true }
      });

      // Cargo de crédito si la venta incluye FIADO.
      if (fiadoCents > 0 && customerForCredit && customerPkId) {
        await tx.creditMovement.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            customerId: customerPkId,
            type: "FIAO_SALE",
            amountCents: fiadoCents,
            saleId: sale.id,
            clientOperationId: operation.id,
            occurredAt
          }
        });
      }

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

      // Replicar el cargo de crédito como delta CREDIT para los clientes.
      if (fiadoCents > 0 && customerForCredit) {
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "CREDIT",
            payload: {
              movementId: crypto.randomUUID(),
              type: "FIAO_SALE",
              customerId: payload.customerId,
              amountCents: fiadoCents,
              saleId: payload.saleId,
              abonoId: null,
              occurredAt: occurredAt.toISOString()
            }
          },
          select: { seq: true }
        });
      }

      // Lealtad: ganancia de puntos y/o redención (spec §8).
      const loyaltyChanges = await createLoyaltyDeltas(
        tx,
        context,
        operation.id,
        payload,
        totals.totalCents,
        customerPkId,
        sale.id,
        occurredAt
      );
      for (const loyaltyChange of loyaltyChanges) {
        await tx.syncChange.create({
          data: {
            ownerId: context.ownerId,
            branchId: context.branchId,
            clientOperationId: operation.id,
            type: "LOYALTY",
            payload: loyaltyChange as never
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

function saleChangePayload(payload: SaleOperationPayload, totals: { subtotalCents: number; totalCents: number }) {
  return {
    saleId: payload.saleId,
    customerId: payload.customerId ?? null,
    lines: payload.lines,
    payments: payload.payments,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    ...(payload.promotionIds && payload.promotionIds.length > 0 ? { promotionIds: payload.promotionIds } : {}),
    ...((payload.discountCents ?? 0) > 0 ? { discountCents: payload.discountCents } : {}),
    ...(payload.reward ? { reward: payload.reward } : {})
  };
}

/**
 * Valida las promos de la venta con la función pura del dominio:
 * recomputa `applyPromotions` con las promos activas del owner en el momento
 * de la operación y exige que el descuento y los IDs coincidan EXACTOS.
 * Devuelve el descuento de promos validado, o null si hay desajuste.
 */
async function validatePromotions(
  context: CommandContext,
  envelope: ClientOperationEnvelope,
  payload: SaleOperationPayload,
  discountCents: number,
  db: FiaoPrismaClient
): Promise<number | null> {
  if ((payload.promotionIds === undefined || payload.promotionIds.length === 0) && discountCents === 0) {
    return 0;
  }
  const rows = await db.promotion.findMany({
    where: { ownerId: context.ownerId, active: true },
    select: {
      id: true,
      kind: true,
      scope: true,
      productId: true,
      percentOffCents: true,
      fixedOffCents: true,
      buyQty: true,
      getQty: true,
      active: true,
      startsAt: true,
      endsAt: true
    }
  });
  const promotions: PromotionInput[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as PromotionInput["kind"],
    scope: row.scope as PromotionInput["scope"],
    productId: row.productId,
    percentOffCents: row.percentOffCents,
    fixedOffCents: row.fixedOffCents,
    buyQty: row.buyQty,
    getQty: row.getQty,
    active: row.active,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null
  }));
  const now = new Date(envelope.occurredAt);
  const result = applyPromotions(payload.lines, promotions, now);
  const applied = new Set(result.appliedPromotionIds);
  const claimed = new Set(payload.promotionIds ?? []);
  if (applied.size !== claimed.size) return null;
  for (const id of applied) {
    if (!claimed.has(id)) return null;
  }
  if (result.totalDiscountCents !== discountCents) return null;
  return result.totalDiscountCents;
}

/**
 * Valida la redención de lealtad: recompensa activa, saldo suficiente y
 * umbral mínimo de descuento (FIXED_DISCOUNT exige el descuento fijo;
 * FREE_PRODUCT exige que el producto esté en las líneas). Devuelve el
 * descuento esperado de la redención para separarlo del de las promos.
 */
async function validateRedemption(
  context: CommandContext,
  payload: SaleOperationPayload,
  discountCents: number,
  db: FiaoPrismaClient
): Promise<{ rewardId: string; pointsCost: number; discountCents: number } | null> {
  if (!payload.reward) return null;
  if (!payload.customerId) return null;

  const reward = await db.loyaltyReward.findFirst({
    where: { rewardId: payload.reward.rewardId, ownerId: context.ownerId, active: true },
    select: { rewardId: true, kind: true, productId: true, discountCents: true, pointsCost: true }
  });
  if (!reward) return null;
  if (reward.pointsCost !== payload.reward.pointsCost) return null;

  const customer = await db.customer.findFirst({
    where: { customerId: payload.customerId, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true }
  });
  if (!customer) return null;
  const movements = await db.loyaltyMovement.findMany({
    where: { ownerId: context.ownerId, branchId: context.branchId, customerId: customer.id },
    select: { type: true, pointsDelta: true, occurredAt: true, expiresAt: true }
  });
  const config = await db.loyaltyConfig.findUnique({
    where: { ownerId: context.ownerId },
    select: { expiryDays: true }
  });
  const balance = computeLoyaltyBalance(
    movements.map((movement) => ({
      type: movement.type as LoyaltyMovementType,
      pointsDelta: movement.pointsDelta,
      occurredAt: movement.occurredAt.toISOString(),
      expiresAt: movement.expiresAt ? movement.expiresAt.toISOString() : null
    })),
    new Date(),
    config?.expiryDays ?? 180
  );
  try {
    assertRedemptionAllowed({ balance, pointsCost: reward.pointsCost, rewardActive: true });
  } catch {
    return null;
  }

  if (reward.kind === "FIXED_DISCOUNT") {
    const expected = Math.min(reward.discountCents ?? 0, Number.MAX_SAFE_INTEGER);
    if (discountCents < expected) return null;
    return { rewardId: reward.rewardId, pointsCost: reward.pointsCost, discountCents: expected };
  }
  if (reward.kind === "FREE_PRODUCT") {
    if (!reward.productId || !payload.lines.some((line) => line.productId === reward.productId)) return null;
    return { rewardId: reward.rewardId, pointsCost: reward.pointsCost, discountCents: 0 };
  }
  return null;
}

function discountCentsFor(payload: SaleOperationPayload): number {
  return payload.discountCents ?? 0;
}

/** Crea los movimientos de lealtad (EARN/REDEEM) y sus deltas de sync. */
async function createLoyaltyDeltas(
  tx: Prisma.TransactionClient,
  context: CommandContext,
  operationId: string,
  payload: SaleOperationPayload,
  totalCents: number,
  customerPkId: string | null,
  salePkId: string,
  occurredAt: Date
): Promise<Record<string, unknown>[]> {
  const deltas: Record<string, unknown>[] = [];
  if (!payload.customerId || !customerPkId) return deltas;

  const config = await tx.loyaltyConfig.findUnique({
    where: { ownerId: context.ownerId },
    select: { enabled: true, pointsPerHundredCents: true, expiryDays: true }
  });

  // Redención primero (consume saldo), luego la ganancia de la venta.
  if (payload.reward) {
    const movementId = crypto.randomUUID();
    await tx.loyaltyMovement.create({
      data: {
        ownerId: context.ownerId,
        branchId: context.branchId,
        customerId: customerPkId,
        movementId,
        type: "REDEEM",
        pointsDelta: -payload.reward.pointsCost,
        saleId: salePkId,
        rewardId: payload.reward.rewardId,
        reason: "Canje de recompensa en venta",
        expiresAt: null,
        clientOperationId: operationId,
        occurredAt
      }
    });
    deltas.push({
      movementId,
      type: "REDEEM",
      customerId: payload.customerId,
      pointsDelta: -payload.reward.pointsCost,
      rewardId: payload.reward.rewardId,
      saleId: payload.saleId,
      occurredAt: occurredAt.toISOString()
    });
  }

  if (config?.enabled !== false && totalCents > 0) {
    const points = computePointsEarned(totalCents, config?.pointsPerHundredCents ?? 100);
    if (points > 0) {
      const movementId = crypto.randomUUID();
      const expiresAt = loyaltyExpiresAt(occurredAt.toISOString(), config?.expiryDays ?? 180);
      await tx.loyaltyMovement.create({
        data: {
          ownerId: context.ownerId,
          branchId: context.branchId,
          customerId: customerPkId,
          movementId,
          type: "EARN",
          pointsDelta: points,
          saleId: salePkId,
          rewardId: null,
          reason: null,
          expiresAt: new Date(expiresAt),
          clientOperationId: operationId,
          occurredAt
        }
      });
      deltas.push({
        movementId,
        type: "EARN",
        customerId: payload.customerId,
        pointsDelta: points,
        rewardId: null,
        saleId: payload.saleId,
        expiresAt,
        occurredAt: occurredAt.toISOString()
      });
    }
  }
  return deltas;
}

function fiadoTotalCents(payments: SalePayment[]): number {
  return payments.reduce((sum, payment) => (payment.method === "FIADO" ? sum + payment.amountCents : sum), 0);
}

async function loadCustomerWithBalance(
  context: CommandContext,
  customerId: string,
  db: FiaoPrismaClient
): Promise<{ creditLimitCents: number; balanceCents: number } | null> {
  const customer = await db.customer.findUnique({
    where: { customerId },
    select: { id: true, creditLimitCents: true, ownerId: true, branchId: true }
  });
  if (!customer || customer.ownerId !== context.ownerId || customer.branchId !== context.branchId) return null;
  const movements = await db.creditMovement.findMany({
    where: { ownerId: context.ownerId, branchId: context.branchId, customerId: customer.id },
    select: { type: true, amountCents: true }
  });
  return { creditLimitCents: customer.creditLimitCents, balanceCents: creditBalanceCents(movements) };
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
