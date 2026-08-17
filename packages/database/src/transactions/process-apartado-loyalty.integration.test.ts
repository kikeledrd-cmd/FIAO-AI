import type { ApartadoCancelPayload, ApartadoCompletePayload, ApartadoCreatePayload } from "@fiao/contracts/apartado";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processApartadoCancel } from "@fiao/database/transactions/process-apartado-cancel";
import { processApartadoComplete } from "@fiao/database/transactions/process-apartado-complete";
import { processApartadoCreate } from "@fiao/database/transactions/process-apartado-create";
import { processCashClose } from "@fiao/database/transactions/process-cash-close";
import { processCashOpen } from "@fiao/database/transactions/process-cash-open";
import { processSaleOperation } from "@fiao/database/transactions/process-sale";
import { processSaleReversal } from "@fiao/database/transactions/process-sale-reversal";
import { computeExpectedCashForSession } from "@fiao/database/transactions/cash-shared";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerDevice: { id: string };
let cashierDevice: { id: string };
let productA: { id: string };
let customer: { customerId: string; id: string };
let sessionId: string;

function context(role: "OWNER" | "CASHIER" = "OWNER"): CommandContext {
  return {
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    userId: role === "OWNER" ? fixtures.ownerUser.id : fixtures.cashier.id,
    role,
    deviceId: role === "OWNER" ? ownerDevice.id : cashierDevice.id,
    now: new Date()
  };
}

function envelope(
  type: string,
  payload: unknown,
  overrides: Partial<ClientOperationEnvelope> = {},
  actorRole: "OWNER" | "CASHIER" = "OWNER"
): ClientOperationEnvelope {
  const actor = context(actorRole);
  return {
    operationId: crypto.randomUUID(),
    type,
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    actorUserId: actor.userId,
    deviceId: actor.deviceId,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload,
    ...overrides
  };
}

async function openSession(role: "OWNER" | "CASHIER" = "CASHIER"): Promise<void> {
  const operationId = crypto.randomUUID();
  const result = await processCashOpen(
    context(role),
    envelope(
      "CASH_OPEN",
      {
        sessionId,
        branchId: fixtures.branchA.id,
        openingFloatCents: 2000_00,
        occurredAt: new Date().toISOString()
      },
      { operationId },
      role
    )
  );
  expect(result.status).toBe("ACCEPTED");
}

async function createOwnerAuthorization(purpose: string, operationId: string): Promise<string> {
  const auth = await databaseClient.ownerAuthorization.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      authorizerUserId: fixtures.ownerUser.id,
      purpose,
      targetOperationId: operationId,
      expiresAt: new Date(Date.now() + 5 * 60_000)
    }
  });
  return auth.id;
}

function apartadoCreatePayload(overrides: Partial<ApartadoCreatePayload> = {}): ApartadoCreatePayload {
  return {
    apartadoId: crypto.randomUUID(),
    branchId: fixtures.branchA.id,
    customerId: customer.customerId,
    lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
    depositCents: 5000,
    totalCents: 10_000,
    actorUserId: context("CASHIER").userId,
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Owner phone");
  cashierDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "Cashier phone");
  await factory.assignUserToBranch(fixtures.ownerUser.id, fixtures.branchA.id);
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 5000, onHand: "10" });
  sessionId = crypto.randomUUID();
});

beforeEach(async () => {
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.loyaltyMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.stockMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.creditMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.cashMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.cashSession.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.apartadoLine.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.apartado.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.ownerAuthorization.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.customer.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.productStock.update({ where: { productId: productA.id }, data: { onHand: "10", reserved: "0" } });
  await databaseClient.loyaltyConfig.deleteMany({ where: { ownerId: fixtures.owner.id } });
  await databaseClient.loyaltyReward.deleteMany({ where: { ownerId: fixtures.owner.id } });
  await databaseClient.promotion.deleteMany({ where: { ownerId: fixtures.owner.id } });

  const created = await databaseClient.customer.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      customerId: crypto.randomUUID(),
      name: "María Cliente",
      creditLimitCents: 100_000
    }
  });
  customer = created;
  sessionId = crypto.randomUUID();
});

describe("processApartadoCreate", () => {
  it("requires an open cash session (el anticipo entra a caja)", async () => {
    const result = await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", apartadoCreatePayload(), {}, "CASHIER"),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("CASH_SESSION_REQUIRED");
  });

  it("reserves stock and records the deposit as INJECTION", async () => {
    await openSession("CASHIER");
    const result = await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", apartadoCreatePayload(), {}, "CASHIER"),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.onHand).toBe("10");
    expect(stock.reserved).toBe("2");

    const movement = await databaseClient.cashMovement.findFirstOrThrow({
      where: { session: { sessionId } }
    });
    expect(movement.type).toBe("INJECTION");
    expect(movement.category).toBe("APARTADO_DEPOSIT");
    expect(movement.amountCents).toBe(5000);
  });

  it("rejects when available stock is insufficient", async () => {
    await openSession("CASHIER");
    const result = await processApartadoCreate(
      context("CASHIER"),
      envelope(
        "APARTADO_CREATE",
        apartadoCreatePayload({ lines: [{ productId: productA.id, quantity: "11", priceCents: 5000 }], totalCents: 55_000 }),
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("INSUFFICIENT_STOCK");
  });

  it("is idempotent on retry", async () => {
    await openSession("CASHIER");
    const operationId = crypto.randomUUID();
    const first = await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", apartadoCreatePayload(), { operationId }, "CASHIER"),
      databaseClient
    );
    const second = await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", apartadoCreatePayload(), { operationId }, "CASHIER"),
      databaseClient
    );
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    expect(second.latestCursor).toBe(first.latestCursor);
    expect(await databaseClient.apartado.count({ where: { branchId: fixtures.branchA.id } })).toBe(1);
  });
});

describe("processApartadoComplete", () => {
  it("creates the real sale and consumes the reservation without double-counting cash", async () => {
    await openSession("CASHIER");
    const payload = apartadoCreatePayload({ depositCents: 4000 });
    const created = await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", payload, {}, "CASHIER"),
      databaseClient
    );
    expect(created.status).toBe("ACCEPTED");

    const completePayload: ApartadoCompletePayload = {
      apartadoId: payload.apartadoId,
      branchId: fixtures.branchA.id,
      remainderPayments: [{ method: "CASH", amountCents: 6000 }],
      occurredAt: new Date().toISOString()
    };
    const completed = await processApartadoComplete(
      context("CASHIER"),
      envelope("APARTADO_COMPLETE", completePayload, {}, "CASHIER"),
      databaseClient
    );
    expect(completed.status).toBe("ACCEPTED");

    const apartado = await databaseClient.apartado.findFirstOrThrow({
      where: { apartadoId: payload.apartadoId }
    });
    expect(apartado.status).toBe("COMPLETED");

    const sale = await databaseClient.sale.findFirstOrThrow({
      where: { apartadoId: apartado.id }
    });
    expect(sale.totalCents).toBe(10_000);
    expect((sale.payments as { method: string; amountCents: number }[]).some((payment) => payment.method === "APARTADO_CREDIT" && payment.amountCents === 4000)).toBe(true);

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.onHand).toBe("8");
    expect(stock.reserved).toBe("0");

    // Esperado = float + anticipo (INJECTION) + resto cash − 0 = 2000 + 40 + 60.
    const session = await databaseClient.cashSession.findFirstOrThrow({
      where: { sessionId }
    });
    const expected = await computeExpectedCashForSession(databaseClient, context(), session);
    expect(expected).toBe(2000_00 + 4000 + 6000);
  });

  it("rejects a remainder that does not complete the total", async () => {
    await openSession("CASHIER");
    const payload = apartadoCreatePayload();
    await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", payload, {}, "CASHIER"),
      databaseClient
    );
    const completePayload: ApartadoCompletePayload = {
      apartadoId: payload.apartadoId,
      branchId: fixtures.branchA.id,
      remainderPayments: [{ method: "CASH", amountCents: 1000 }],
      occurredAt: new Date().toISOString()
    };
    const completed = await processApartadoComplete(
      context("CASHIER"),
      envelope("APARTADO_COMPLETE", completePayload, {}, "CASHIER"),
      databaseClient
    );
    expect(completed.status).toBe("REJECTED");
    expect(completed.errorCode).toBe("REMAINDER_MISMATCH");
  });
});

describe("processApartadoCancel", () => {
  it("requires owner authorization for a cashier", async () => {
    await openSession("CASHIER");
    const payload = apartadoCreatePayload();
    await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", payload, {}, "CASHIER"),
      databaseClient
    );
    const cancelPayload: ApartadoCancelPayload = {
      apartadoId: payload.apartadoId,
      branchId: fixtures.branchA.id,
      reason: "El cliente no volvió",
      occurredAt: new Date().toISOString()
    };
    const denied = await processApartadoCancel(
      context("CASHIER"),
      envelope("APARTADO_CANCEL", cancelPayload, {}, "CASHIER"),
      databaseClient
    );
    expect(denied.status).toBe("REJECTED");
    expect(denied.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("releases stock, refunds the deposit as credit and removes cash", async () => {
    await openSession("CASHIER");
    const payload = apartadoCreatePayload({ depositCents: 5000 });
    await processApartadoCreate(
      context("CASHIER"),
      envelope("APARTADO_CREATE", payload, {}, "CASHIER"),
      databaseClient
    );

    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("APARTADO_CANCEL", operationId);
    const cancelPayload: ApartadoCancelPayload = {
      apartadoId: payload.apartadoId,
      branchId: fixtures.branchA.id,
      reason: "Cliente canceló",
      ownerAuthorizationId: authId,
      occurredAt: new Date().toISOString()
    };
    const cancelled = await processApartadoCancel(
      context("CASHIER"),
      envelope("APARTADO_CANCEL", cancelPayload, { operationId }, "CASHIER"),
      databaseClient
    );
    expect(cancelled.status).toBe("ACCEPTED");

    const apartado = await databaseClient.apartado.findFirstOrThrow({ where: { apartadoId: payload.apartadoId } });
    expect(apartado.status).toBe("CANCELLED");

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.reserved).toBe("0");

    // Crédito a favor del cliente (saldo negativo = -5000).
    const movements = await databaseClient.creditMovement.findMany({
      where: { customerId: customer.id }
    });
    expect(movements.some((movement) => movement.type === "APARTADO_REFUND" && movement.amountCents === 5000)).toBe(true);

    // El efectivo sale de caja (WITHDRAWAL).
    const cashMovement = await databaseClient.cashMovement.findFirstOrThrow({
      where: { session: { sessionId }, type: "WITHDRAWAL" }
    });
    expect(cashMovement.amountCents).toBe(5000);
    expect(cashMovement.reason).toContain("cancelación");
  });
});

describe("loyalty: earn, redeem and reversal", () => {
  it("earns points on a sale with a customer (1 point per RD$100)", async () => {
    await databaseClient.loyaltyConfig.create({
      data: { ownerId: fixtures.owner.id, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
    });
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          customerId: customer.customerId,
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 10_000 }]
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");

    const earn = await databaseClient.loyaltyMovement.findFirstOrThrow({
      where: { customerId: customer.id, type: "EARN" }
    });
    expect(earn.pointsDelta).toBe(100);
    expect(earn.expiresAt).not.toBeNull();
  });

  it("rejects a redemption without enough balance", async () => {
    await databaseClient.loyaltyConfig.create({
      data: { ownerId: fixtures.owner.id, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
    });
    await databaseClient.loyaltyReward.create({
      data: {
        ownerId: fixtures.owner.id,
        rewardId: crypto.randomUUID(),
        name: "Descuento RD$50",
        kind: "FIXED_DISCOUNT",
        discountCents: 5000,
        pointsCost: 500,
        active: true
      }
    });
    const reward = await databaseClient.loyaltyReward.findFirstOrThrow({ where: { ownerId: fixtures.owner.id } });
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          customerId: customer.customerId,
          lines: [{ productId: productA.id, quantity: "1", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 5000 }],
          reward: { rewardId: reward.rewardId, pointsCost: 500 }
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("INVALID_REWARD");
  });

  it("accepts a redemption with enough balance and a fixed discount", async () => {
    await databaseClient.loyaltyConfig.create({
      data: { ownerId: fixtures.owner.id, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
    });
    // Saldo previo: 600 puntos vía una venta anterior.
    await databaseClient.loyaltyMovement.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId: fixtures.branchA.id,
        customerId: customer.id,
        movementId: crypto.randomUUID(),
        type: "EARN",
        pointsDelta: 600,
        saleId: null,
        rewardId: null,
        expiresAt: new Date(Date.now() + 180 * 86_400_000),
        occurredAt: new Date()
      }
    });
    await databaseClient.loyaltyReward.create({
      data: {
        ownerId: fixtures.owner.id,
        rewardId: crypto.randomUUID(),
        name: "Descuento RD$50",
        kind: "FIXED_DISCOUNT",
        discountCents: 5000,
        pointsCost: 500,
        active: true
      }
    });
    const reward = await databaseClient.loyaltyReward.findFirstOrThrow({ where: { ownerId: fixtures.owner.id } });
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          customerId: customer.customerId,
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 5000 }],
          reward: { rewardId: reward.rewardId, pointsCost: 500 },
          discountCents: 5000
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");
    const redeem = await databaseClient.loyaltyMovement.findFirstOrThrow({
      where: { customerId: customer.id, type: "REDEEM" }
    });
    expect(redeem.pointsDelta).toBe(-500);
  });

  it("reverses loyalty points when the sale is reversed", async () => {
    await databaseClient.loyaltyConfig.create({
      data: { ownerId: fixtures.owner.id, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
    });
    const saleId = crypto.randomUUID();
    const saleResult = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId,
          customerId: customer.customerId,
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 10_000 }]
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(saleResult.status).toBe("ACCEPTED");

    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("SALE_REVERSAL", operationId);
    const reversal = await processSaleReversal(
      context("CASHIER"),
      envelope(
        "SALE_REVERSAL",
        {
          reversalId: crypto.randomUUID(),
          saleId,
          reason: "Devolución",
          ownerAuthorizationId: authId
        },
        { operationId },
        "CASHIER"
      ),
      databaseClient
    );
    expect(reversal.status).toBe("ACCEPTED");

    const reversalMovement = await databaseClient.loyaltyMovement.findFirstOrThrow({
      where: { customerId: customer.id, type: "REVERSAL" }
    });
    expect(reversalMovement.pointsDelta).toBe(-100);
  });
});

describe("deterministic promotions", () => {
  it("validates the claimed discount by recomputing with the pure function", async () => {
    await databaseClient.promotion.create({
      data: {
        ownerId: fixtures.owner.id,
        name: "15% en arroz",
        kind: "PERCENT_OFF",
        scope: "PRODUCT",
        productId: productA.id,
        percentOffCents: 1500,
        active: true
      }
    });
    const promotion = await databaseClient.promotion.findFirstOrThrow({ where: { ownerId: fixtures.owner.id } });
    // Subtotal 10.000 → 15% = 1.500 de descuento → paga 8.500.
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 8500 }],
          promotionIds: [promotion.id],
          discountCents: 1500
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");
  });

  it("rejects a claimed discount that does not match the recompute", async () => {
    await databaseClient.promotion.create({
      data: {
        ownerId: fixtures.owner.id,
        name: "15% en arroz",
        kind: "PERCENT_OFF",
        scope: "PRODUCT",
        productId: productA.id,
        percentOffCents: 1500,
        active: true
      }
    });
    const promotion = await databaseClient.promotion.findFirstOrThrow({ where: { ownerId: fixtures.owner.id } });
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 7000 }],
          promotionIds: [promotion.id],
          discountCents: 3000
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("PROMOTION_MISMATCH");
  });

  it("rejects a sale claiming an inactive promotion", async () => {
    await databaseClient.promotion.create({
      data: {
        ownerId: fixtures.owner.id,
        name: "Inactiva",
        kind: "FIXED_OFF",
        scope: "TOTAL",
        fixedOffCents: 1000,
        active: false
      }
    });
    const promotion = await databaseClient.promotion.findFirstOrThrow({ where: { ownerId: fixtures.owner.id } });
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope(
        "SALE",
        {
          saleId: crypto.randomUUID(),
          lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
          payments: [{ method: "CASH", amountCents: 9000 }],
          promotionIds: [promotion.id],
          discountCents: 1000
        },
        {},
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("PROMOTION_MISMATCH");
  });
});
