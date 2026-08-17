import type { SaleOperationPayload } from "@fiao/contracts/sales";
import type { SaleReversalPayload, StockAdjustmentPayload } from "@fiao/contracts/inventory";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processSaleOperation } from "@fiao/database/transactions/process-sale";
import { processSaleReversal } from "@fiao/database/transactions/process-sale-reversal";
import { processStockAdjustment } from "@fiao/database/transactions/process-stock-adjustment";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerDevice: { id: string };
let cashierDevice: { id: string };
let productA: { id: string; priceCents: number };
let productB: { id: string; priceCents: number };

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

function adjustmentPayload(overrides: Partial<StockAdjustmentPayload> = {}): StockAdjustmentPayload {
  return {
    adjustmentId: crypto.randomUUID(),
    productId: productA.id,
    quantityDelta: "5",
    reason: "Compra al proveedor",
    ...overrides
  };
}

function cashSalePayload(overrides: Partial<SaleOperationPayload> = {}): SaleOperationPayload {
  return {
    saleId: crypto.randomUUID(),
    lines: [{ productId: productA.id, quantity: "2", priceCents: productA.priceCents }],
    payments: [{ method: "CASH", amountCents: productA.priceCents * 2 }],
    ...overrides
  };
}

async function onHand(productId: string): Promise<string> {
  const stock = await databaseClient.productStock.findUnique({ where: { productId } });
  return stock?.onHand ?? "0";
}

async function stockMovements(): Promise<Array<{ type: string; quantityDelta: string; productId: string }>> {
  return databaseClient.stockMovement.findMany({
    where: { branchId: fixtures.branchA.id },
    select: { type: true, quantityDelta: true, productId: true }
  });
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Celular del dueño");
  cashierDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "POS cajero");
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 5500, onHand: "10" });
  productB = await factory.createProduct(fixtures.branchA, { name: "Aceite", priceCents: 12000, onHand: "5" });
});

beforeEach(async () => {
  await databaseClient.productStock.update({ where: { productId: productA.id }, data: { onHand: "10" } });
  await databaseClient.productStock.update({ where: { productId: productB.id }, data: { onHand: "5" } });
  // Orden respetando FK Restrict hacia clientOperation.
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.stockMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.creditMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.loyaltyMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.customer.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.ownerAuthorization.deleteMany({ where: { branchId: fixtures.branchA.id } });
});

describe("processStockAdjustment", () => {
  it("accepts a positive adjustment as OWNER", async () => {
    const result = await processStockAdjustment(context("OWNER"), envelope("STOCK_ADJUSTMENT", adjustmentPayload()));

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
    const movements = await stockMovements();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "ADJUSTMENT", quantityDelta: "5" });
  });

  it("accepts a negative adjustment as OWNER", async () => {
    const result = await processStockAdjustment(
      context("OWNER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload({ quantityDelta: "-3", reason: "Merma" }))
    );

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("7");
  });

  it("rejects a delta that would leave stock negative", async () => {
    const result = await processStockAdjustment(
      context("OWNER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload({ quantityDelta: "-30" }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("STOCK_NEGATIVE");
    expect(await onHand(productA.id)).toBe("10");
  });

  it("rejects an unknown product", async () => {
    const result = await processStockAdjustment(
      context("OWNER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload({ productId: crypto.randomUUID() }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_PRODUCT");
  });

  it("rejects a CASHIER without owner authorization", async () => {
    const result = await processStockAdjustment(
      context("CASHIER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload(), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("accepts a CASHIER with a valid owner authorization", async () => {
    const operationId = crypto.randomUUID();
    const auth = await databaseClient.ownerAuthorization.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId: fixtures.branchA.id,
        authorizerUserId: fixtures.ownerUser.id,
        purpose: "STOCK_ADJUSTMENT",
        targetOperationId: operationId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    const result = await processStockAdjustment(
      context("CASHIER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload({ ownerAuthorizationId: auth.id }), { operationId }, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
  });

  it("rejects a CASHIER with an expired owner authorization", async () => {
    const operationId = crypto.randomUUID();
    const auth = await databaseClient.ownerAuthorization.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId: fixtures.branchA.id,
        authorizerUserId: fixtures.ownerUser.id,
        purpose: "STOCK_ADJUSTMENT",
        targetOperationId: operationId,
        expiresAt: new Date(Date.now() - 1000)
      }
    });
    const result = await processStockAdjustment(
      context("CASHIER"),
      envelope("STOCK_ADJUSTMENT", adjustmentPayload({ ownerAuthorizationId: auth.id }), { operationId }, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("is idempotent on retry", async () => {
    const firstEnvelope = envelope("STOCK_ADJUSTMENT", adjustmentPayload());
    const first = await processStockAdjustment(context("OWNER"), firstEnvelope);
    const retry = await processStockAdjustment(context("OWNER"), firstEnvelope);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
    expect(await stockMovements()).toHaveLength(1);
  });
});

describe("processSaleReversal", () => {
  async function createCashSale(): Promise<{ saleId: string }> {
    const payload = cashSalePayload();
    const result = await processSaleOperation(
      context("CASHIER"),
      envelope("SALE", payload, { operationId: crypto.randomUUID() }, "CASHIER")
    );
    expect(result.status).toBe("ACCEPTED");
    return { saleId: payload.saleId };
  }

  it("rejects a CASHIER without owner authorization", async () => {
    const { saleId } = await createCashSale();
    const result = await processSaleReversal(
      context("CASHIER"),
      envelope("SALE_REVERSAL", { reversalId: crypto.randomUUID(), saleId, reason: "Cliente devolvió" }, {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("reverses a cash sale and restores stock", async () => {
    const { saleId } = await createCashSale();
    expect(await onHand(productA.id)).toBe("8");

    const result = await processSaleReversal(context("OWNER"), envelope("SALE_REVERSAL", { reversalId: crypto.randomUUID(), saleId, reason: "Cliente devolvió" }));

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("10");
    const movements = await stockMovements();
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({ type: "REVERSAL", quantityDelta: "+2" });
  });

  it("accepts a CASHIER with a valid owner authorization", async () => {
    const { saleId } = await createCashSale();
    const operationId = crypto.randomUUID();
    const auth = await databaseClient.ownerAuthorization.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId: fixtures.branchA.id,
        authorizerUserId: fixtures.ownerUser.id,
        purpose: "SALE_REVERSAL",
        targetOperationId: operationId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    const result = await processSaleReversal(
      context("CASHIER"),
      envelope(
        "SALE_REVERSAL",
        { reversalId: crypto.randomUUID(), saleId, reason: "Devolución", ownerAuthorizationId: auth.id },
        { operationId },
        "CASHIER"
      )
    );

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("10");
  });

  it("rejects a reversal of an unknown sale", async () => {
    const result = await processSaleReversal(context("OWNER"), envelope("SALE_REVERSAL", { reversalId: crypto.randomUUID(), saleId: crypto.randomUUID(), reason: "No existe" }));

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_SALE");
  });

  it("rejects a duplicate reversal of the same sale", async () => {
    const { saleId } = await createCashSale();
    const reversalPayload: SaleReversalPayload = { reversalId: crypto.randomUUID(), saleId, reason: "Devolución" };
    const first = await processSaleReversal(context("OWNER"), envelope("SALE_REVERSAL", reversalPayload));
    expect(first.status).toBe("ACCEPTED");

    const retry = await processSaleReversal(context("OWNER"), envelope("SALE_REVERSAL", reversalPayload));
    expect(retry.status).toBe("REJECTED");
    expect(retry.errorCode).toBe("SALE_ALREADY_REVERSED");
    expect(await onHand(productA.id)).toBe("10");
  });
});
