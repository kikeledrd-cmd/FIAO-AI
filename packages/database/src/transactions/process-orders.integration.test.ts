import type {
  OrderAdvancePayload,
  OrderCancelPayload,
  OrderCreatePayload,
  OrderDeliverPayload
} from "@fiao/contracts/orders";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processOrderAccept } from "@fiao/database/transactions/process-order-accept";
import { processOrderAdvance } from "@fiao/database/transactions/process-order-advance";
import { processOrderCancel } from "@fiao/database/transactions/process-order-cancel";
import { processOrderCreate } from "@fiao/database/transactions/process-order-create";
import { processOrderDeliver } from "@fiao/database/transactions/process-order-deliver";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerDevice: { id: string };
let cashierDevice: { id: string };
let productA: { id: string };
let customer: { customerId: string; id: string };

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

function orderCreatePayload(overrides: Partial<OrderCreatePayload> = {}): OrderCreatePayload {
  return {
    orderId: crypto.randomUUID(),
    branchId: fixtures.branchA.id,
    source: "WHATSAPP",
    customerId: null,
    lines: [{ productId: productA.id, quantity: "2", priceCents: 5000 }],
    deliveryName: "Calle 5",
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

async function createAcceptedOrder(): Promise<{ orderId: string; payload: OrderCreatePayload }> {
  const payload = orderCreatePayload();
  const created = await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
  expect(created.status).toBe("ACCEPTED");
  const accepted = await processOrderAccept(
    context(),
    envelope("ORDER_ACCEPT", { orderId: payload.orderId, branchId: fixtures.branchA.id, occurredAt: new Date().toISOString() }),
    databaseClient
  );
  expect(accepted.status).toBe("ACCEPTED");
  return { orderId: payload.orderId, payload };
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Owner phone");
  cashierDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "Cashier phone");
  await factory.assignUserToBranch(fixtures.ownerUser.id, fixtures.branchA.id);
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 5000, onHand: "10" });
});

beforeEach(async () => {
  await databaseClient.order.deleteMany({ where: { branchId: fixtures.branchA.id } });
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
});

describe("processOrderCreate", () => {
  it("creates a NEW order without reserving stock", async () => {
    const payload = orderCreatePayload();
    const result = await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
    expect(result.status).toBe("ACCEPTED");

    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId: payload.orderId } });
    expect(order.status).toBe("NEW");
    expect(order.totalCents).toBe(10_000);

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.reserved).toBe("0");
  });

  it("is idempotent on retry", async () => {
    const payload = orderCreatePayload();
    const operationId = crypto.randomUUID();
    const first = await processOrderCreate(context(), envelope("ORDER_CREATE", payload, { operationId }), databaseClient);
    const second = await processOrderCreate(context(), envelope("ORDER_CREATE", payload, { operationId }), databaseClient);
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    expect(second.latestCursor).toBe(first.latestCursor);
    expect(await databaseClient.order.count({ where: { branchId: fixtures.branchA.id } })).toBe(1);
  });
});

describe("processOrderAccept", () => {
  it("reserves stock when accepted", async () => {
    const payload = orderCreatePayload();
    await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
    const result = await processOrderAccept(
      context(),
      envelope("ORDER_ACCEPT", { orderId: payload.orderId, branchId: fixtures.branchA.id, occurredAt: new Date().toISOString() }),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");

    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId: payload.orderId } });
    expect(order.status).toBe("PREPARING");

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.onHand).toBe("10");
    expect(stock.reserved).toBe("2");
  });

  it("rejects when available stock is insufficient", async () => {
    const payload = orderCreatePayload({ lines: [{ productId: productA.id, quantity: "11", priceCents: 5000 }] });
    await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
    const result = await processOrderAccept(
      context(),
      envelope("ORDER_ACCEPT", { orderId: payload.orderId, branchId: fixtures.branchA.id, occurredAt: new Date().toISOString() }),
      databaseClient
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("STOCK_INSUFFICIENT");

    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId: payload.orderId } });
    expect(order.status).toBe("NEW");
  });
});

describe("processOrderCancel", () => {
  it("cancels a NEW order freely (no reservation to release)", async () => {
    const payload = orderCreatePayload();
    await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
    const result = await processOrderCancel(
      context("CASHIER"),
      envelope("ORDER_CANCEL", { orderId: payload.orderId, branchId: fixtures.branchA.id, reason: "Cliente canceló", occurredAt: new Date().toISOString() }, {}, "CASHIER"),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");
    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId: payload.orderId } });
    expect(order.status).toBe("CANCELLED");
  });

  it("requires owner authorization after PREPARING", async () => {
    const { orderId } = await createAcceptedOrder();
    const denied = await processOrderCancel(
      context("CASHIER"),
      envelope("ORDER_CANCEL", { orderId, branchId: fixtures.branchA.id, reason: "Cancelar", occurredAt: new Date().toISOString() }, {}, "CASHIER"),
      databaseClient
    );
    expect(denied.status).toBe("REJECTED");
    expect(denied.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("releases the reservation when cancelled with authorization", async () => {
    const { orderId } = await createAcceptedOrder();
    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("ORDER_CANCEL", operationId);
    const result = await processOrderCancel(
      context("CASHIER"),
      envelope(
        "ORDER_CANCEL",
        { orderId, branchId: fixtures.branchA.id, reason: "Sin stock real", ownerAuthorizationId: authId, occurredAt: new Date().toISOString() },
        { operationId },
        "CASHIER"
      ),
      databaseClient
    );
    expect(result.status).toBe("ACCEPTED");

    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId } });
    expect(order.status).toBe("CANCELLED");
    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.reserved).toBe("0");
  });
});

describe("processOrderDeliver", () => {
  async function advanceToOnTheWay(orderId: string): Promise<void> {
    const ready = await processOrderAdvance(
      context(),
      envelope("ORDER_ADVANCE", { orderId, branchId: fixtures.branchA.id, nextStatus: "READY", occurredAt: new Date().toISOString() }),
      databaseClient
    );
    expect(ready.status).toBe("ACCEPTED");
    const onTheWay = await processOrderAdvance(
      context(),
      envelope("ORDER_ADVANCE", { orderId, branchId: fixtures.branchA.id, nextStatus: "ON_THE_WAY", occurredAt: new Date().toISOString() }),
      databaseClient
    );
    expect(onTheWay.status).toBe("ACCEPTED");
  }

  it("finalizes the sale once: decrements stock and releases the reservation", async () => {
    const { orderId } = await createAcceptedOrder();
    await advanceToOnTheWay(orderId);

    const deliverPayload: OrderDeliverPayload = {
      orderId,
      branchId: fixtures.branchA.id,
      payments: [{ method: "CASH", amountCents: 10_000 }],
      occurredAt: new Date().toISOString()
    };
    const result = await processOrderDeliver(context(), envelope("ORDER_DELIVER", deliverPayload), databaseClient);
    expect(result.status).toBe("ACCEPTED");

    const order = await databaseClient.order.findFirstOrThrow({ where: { orderId } });
    expect(order.status).toBe("DELIVERED");
    expect(order.saleId).not.toBeNull();

    const sale = await databaseClient.sale.findFirstOrThrow({ where: { id: order.saleId! } });
    expect(sale.totalCents).toBe(10_000);

    const stock = await databaseClient.productStock.findUniqueOrThrow({ where: { productId: productA.id } });
    expect(stock.onHand).toBe("8");
    expect(stock.reserved).toBe("0");
  });

  it("is idempotent on retry (exactly one sale)", async () => {
    const { orderId } = await createAcceptedOrder();
    await advanceToOnTheWay(orderId);

    const deliverPayload: OrderDeliverPayload = {
      orderId,
      branchId: fixtures.branchA.id,
      payments: [{ method: "CASH", amountCents: 10_000 }],
      occurredAt: new Date().toISOString()
    };
    const operationId = crypto.randomUUID();
    const first = await processOrderDeliver(context(), envelope("ORDER_DELIVER", deliverPayload, { operationId }), databaseClient);
    const second = await processOrderDeliver(context(), envelope("ORDER_DELIVER", deliverPayload, { operationId }), databaseClient);
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("ACCEPTED");
    expect(second.latestCursor).toBe(first.latestCursor);
    expect(await databaseClient.sale.count({ where: { branchId: fixtures.branchA.id } })).toBe(1);
  });

  it("rejects delivery when payments do not match the total", async () => {
    const { orderId } = await createAcceptedOrder();
    await advanceToOnTheWay(orderId);

    const deliverPayload: OrderDeliverPayload = {
      orderId,
      branchId: fixtures.branchA.id,
      payments: [{ method: "CASH", amountCents: 9000 }],
      occurredAt: new Date().toISOString()
    };
    const result = await processOrderDeliver(context(), envelope("ORDER_DELIVER", deliverPayload), databaseClient);
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("charges FIADO and earns loyalty when delivering to a customer", async () => {
    await databaseClient.loyaltyConfig.create({
      data: { ownerId: fixtures.owner.id, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
    });
    const payload = orderCreatePayload({ customerId: customer.customerId });
    await processOrderCreate(context(), envelope("ORDER_CREATE", payload), databaseClient);
    await processOrderAccept(
      context(),
      envelope("ORDER_ACCEPT", { orderId: payload.orderId, branchId: fixtures.branchA.id, occurredAt: new Date().toISOString() }),
      databaseClient
    );
    await advanceToOnTheWay(payload.orderId);

    const deliverPayload: OrderDeliverPayload = {
      orderId: payload.orderId,
      branchId: fixtures.branchA.id,
      payments: [{ method: "FIADO", amountCents: 10_000 }],
      occurredAt: new Date().toISOString()
    };
    const result = await processOrderDeliver(context(), envelope("ORDER_DELIVER", deliverPayload), databaseClient);
    expect(result.status).toBe("ACCEPTED");

    const credit = await databaseClient.creditMovement.findFirstOrThrow({
      where: { customerId: customer.id, type: "FIAO_SALE" }
    });
    expect(credit.amountCents).toBe(10_000);

    const earn = await databaseClient.loyaltyMovement.findFirstOrThrow({
      where: { customerId: customer.id, type: "EARN" }
    });
    expect(earn.pointsDelta).toBe(100);
  });
});
