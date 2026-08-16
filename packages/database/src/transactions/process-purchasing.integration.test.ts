import type { PurchasePayload, SupplierUpsertPayload } from "@fiao/contracts/purchasing";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processPurchase } from "@fiao/database/transactions/process-purchase";
import { processSupplierUpsert } from "@fiao/database/transactions/process-supplier-upsert";
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

function supplierPayload(overrides: Partial<SupplierUpsertPayload> = {}): SupplierUpsertPayload {
  return {
    supplierId: crypto.randomUUID(),
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    name: "Distribuidora La Vega",
    phoneE164: "+18095551111",
    active: true,
    ...overrides
  };
}

function purchasePayload(overrides: Partial<PurchasePayload> = {}): PurchasePayload {
  return {
    purchaseId: crypto.randomUUID(),
    supplierId: null,
    lines: [{ productId: productA.id, quantity: "5", unitCostCents: 8000 }],
    note: null,
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

async function onHand(productId: string): Promise<string> {
  const stock = await databaseClient.productStock.findUnique({ where: { productId } });
  return stock?.onHand ?? "0";
}

async function costCents(productId: string): Promise<number> {
  const product = await databaseClient.product.findUniqueOrThrow({ where: { id: productId } });
  return product.costCents;
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Celular del dueño");
  cashierDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "POS cajero");
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 11000, onHand: "10" });
  productB = await factory.createProduct(fixtures.branchA, { name: "Aceite", priceCents: 15000, onHand: "5" });
});

beforeEach(async () => {
  await databaseClient.productStock.update({ where: { productId: productA.id }, data: { onHand: "10" } });
  await databaseClient.productStock.update({ where: { productId: productB.id }, data: { onHand: "5" } });
  await databaseClient.product.update({ where: { id: productA.id }, data: { costCents: 0 } });
  await databaseClient.product.update({ where: { id: productB.id }, data: { costCents: 0 } });
  // Orden respetando FK Restrict hacia clientOperation.
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.purchaseLine.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.purchase.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.supplier.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.stockMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.creditMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.customer.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.ownerAuthorization.deleteMany({ where: { branchId: fixtures.branchA.id } });
});

describe("processSupplierUpsert", () => {
  it("creates a supplier idempotently", async () => {
    const payload = supplierPayload();
    const first = await processSupplierUpsert(context(), envelope("SUPPLIER_UPSERT", payload));
    const retry = await processSupplierUpsert(context(), envelope("SUPPLIER_UPSERT", payload));

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    const rows = await databaseClient.supplier.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(rows).toHaveLength(1);
  });

  it("updates an existing supplier by supplierId", async () => {
    const payload = supplierPayload();
    await processSupplierUpsert(context(), envelope("SUPPLIER_UPSERT", payload));
    const updated = await processSupplierUpsert(
      context(),
      envelope("SUPPLIER_UPSERT", { ...payload, name: "Distribuidora La Vega SRL" })
    );

    expect(updated.status).toBe("ACCEPTED");
    const row = await databaseClient.supplier.findUniqueOrThrow({ where: { supplierId: payload.supplierId } });
    expect(row.name).toBe("Distribuidora La Vega SRL");
  });
});

describe("processPurchase", () => {
  it("accepts a purchase as OWNER and updates stock + moving average cost", async () => {
    const result = await processPurchase(context(), envelope("PURCHASE", purchasePayload()));

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
    expect(await costCents(productA.id)).toBe(8000); // sin stock previo → costo de compra
    const movements = await databaseClient.stockMovement.findMany({
      where: { branchId: fixtures.branchA.id },
      select: { type: true, quantityDelta: true, productId: true }
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "PURCHASE", quantityDelta: "+5", productId: productA.id });
  });

  it("computes a weighted moving average across purchases", async () => {
    await processPurchase(context(), envelope("PURCHASE", purchasePayload({ purchaseId: crypto.randomUUID() })));
    // 10 a 8000 + 5 a 8000 → 8000
    expect(await costCents(productA.id)).toBe(8000);
    // Compra 5 a 7000: (8000*15 + 7000*5)/20 = 7750
    const result = await processPurchase(
      context(),
      envelope("PURCHASE", purchasePayload({ purchaseId: crypto.randomUUID(), lines: [{ productId: productA.id, quantity: "5", unitCostCents: 7000 }] }))
    );
    expect(result.status).toBe("ACCEPTED");
    expect(await costCents(productA.id)).toBe(7750);
  });

  it("rejects a CASHIER without owner authorization", async () => {
    const result = await processPurchase(context("CASHIER"), envelope("PURCHASE", purchasePayload(), {}, "CASHIER"));

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
        purpose: "PURCHASE",
        targetOperationId: operationId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });
    const result = await processPurchase(
      context("CASHIER"),
      envelope("PURCHASE", purchasePayload({ ownerAuthorizationId: auth.id }), { operationId }, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
  });

  it("rejects a purchase for a product without stock control", async () => {
    const noStock = await factory.createProduct(fixtures.branchA, { name: "Recarga", stockControl: false });
    const result = await processPurchase(
      context(),
      envelope("PURCHASE", purchasePayload({ lines: [{ productId: noStock.id, quantity: "1", unitCostCents: 100 }] }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("STOCK_CONTROL_REQUIRED");
  });

  it("rejects a purchase for an unknown product", async () => {
    const result = await processPurchase(
      context(),
      envelope("PURCHASE", purchasePayload({ lines: [{ productId: crypto.randomUUID(), quantity: "1", unitCostCents: 100 }] }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_PRODUCT");
  });

  it("rejects a purchase with an unknown supplier", async () => {
    const result = await processPurchase(
      context(),
      envelope("PURCHASE", purchasePayload({ supplierId: crypto.randomUUID() }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_SUPPLIER");
  });

  it("is idempotent on retry", async () => {
    const firstEnvelope = envelope("PURCHASE", purchasePayload());
    const first = await processPurchase(context(), firstEnvelope);
    const retry = await processPurchase(context(), firstEnvelope);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    expect(await onHand(productA.id)).toBe("15");
    expect(await costCents(productA.id)).toBe(8000);
    const purchases = await databaseClient.purchase.count({ where: { branchId: fixtures.branchA.id } });
    expect(purchases).toBe(1);
  });

  it("records the supplier reference on the purchase", async () => {
    const supplier = supplierPayload();
    await processSupplierUpsert(context(), envelope("SUPPLIER_UPSERT", supplier));
    const result = await processPurchase(
      context(),
      envelope("PURCHASE", purchasePayload({ supplierId: supplier.supplierId }))
    );

    expect(result.status).toBe("ACCEPTED");
    const purchase = await databaseClient.purchase.findFirstOrThrow({ where: { branchId: fixtures.branchA.id } });
    const supplierRow = await databaseClient.supplier.findUniqueOrThrow({ where: { supplierId: supplier.supplierId } });
    expect(purchase.supplierId).toBe(supplierRow.id);
  });
});
