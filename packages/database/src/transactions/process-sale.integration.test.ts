import type { SaleOperationPayload } from "@fiao/contracts/sales";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processSaleOperation } from "@fiao/database/transactions/process-sale";
import { TestFactory } from "@fiao/testkit";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@fiao/testkit/db";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let device: { id: string };
let productA: { id: string; priceCents: number };
let productB: { id: string; priceCents: number };

function cashierContext(): CommandContext {
  return {
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    userId: fixtures.cashier.id,
    role: "CASHIER",
    deviceId: device.id,
    now: new Date()
  };
}

function envelope(type: string, payload: unknown): ClientOperationEnvelope {
  return {
    operationId: crypto.randomUUID(),
    type,
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    actorUserId: fixtures.cashier.id,
    deviceId: device.id,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload
  };
}

function salePayload(overrides: Partial<SaleOperationPayload> = {}): SaleOperationPayload {
  return {
    saleId: crypto.randomUUID(),
    lines: [
      { productId: productA.id, quantity: "2", priceCents: productA.priceCents },
      { productId: productB.id, quantity: "1", priceCents: productB.priceCents }
    ],
    payments: [{ method: "CASH", amountCents: productA.priceCents * 2 + productB.priceCents }],
    ...overrides
  };
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  device = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "POS de prueba");
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 5500, onHand: "10" });
  productB = await factory.createProduct(fixtures.branchA, { name: "Habichuelas", priceCents: 3200, onHand: "20" });
});

beforeEach(async () => {
  // Los tests mutan stock; restauramos los productos a su estado inicial.
  await databaseClient.productStock.update({ where: { productId: productA.id }, data: { onHand: "10" } });
  await databaseClient.productStock.update({ where: { productId: productB.id }, data: { onHand: "20" } });
  // Orden respetando FK Restrict hacia clientOperation.
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.stockMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
});

describe("processSaleOperation", () => {
  it("accepts a cash sale, decrements stock and records movements", async () => {
    const result = await processSaleOperation(cashierContext(), envelope("SALE", salePayload()));

    expect(result.status).toBe("ACCEPTED");
    expect(Number(result.latestCursor)).toBeGreaterThan(0);

    const sales = await databaseClient.sale.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(sales).toHaveLength(1);
    expect(sales[0]!.subtotalCents).toBe(productA.priceCents * 2 + productB.priceCents);
    expect(sales[0]!.totalCents).toBe(sales[0]!.subtotalCents);

    const stockA = await databaseClient.productStock.findUnique({ where: { productId: productA.id } });
    expect(stockA?.onHand).toBe("8");
    const stockB = await databaseClient.productStock.findUnique({ where: { productId: productB.id } });
    expect(stockB?.onHand).toBe("19");

    const movements = await databaseClient.stockMovement.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.quantityDelta).sort()).toEqual(["-1", "-2"]);

    const changes = await databaseClient.syncChange.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("SALE");
  });

  it("is idempotent: retrying the same operation returns the same result", async () => {
    const op = envelope("SALE", salePayload());
    const first = await processSaleOperation(cashierContext(), op);
    const second = await processSaleOperation(cashierContext(), op);

    expect(second.status).toBe("ACCEPTED");
    expect(second.latestCursor).toBe(first.latestCursor);
    const sales = await databaseClient.sale.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(sales).toHaveLength(1);
    const movements = await databaseClient.stockMovement.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(movements).toHaveLength(2);
  });

  it("rejects a sale when stock is insufficient", async () => {
    const result = await processSaleOperation(
      cashierContext(),
      envelope(
        "SALE",
        salePayload({
          lines: [{ productId: productA.id, quantity: "11", priceCents: productA.priceCents }],
          payments: [{ method: "CASH", amountCents: productA.priceCents * 11 }]
        })
      )
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("STOCK_INSUFFICIENT");
    const sales = await databaseClient.sale.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(sales).toHaveLength(0);
    const movements = await databaseClient.stockMovement.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(movements).toHaveLength(0);
  });

  it("rejects a sale whose payments do not match the total", async () => {
    const result = await processSaleOperation(
      cashierContext(),
      envelope(
        "SALE",
        salePayload({ payments: [{ method: "CASH", amountCents: 1 }] })
      )
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("PAYMENT_TOTAL_MISMATCH");
  });

  it("accepts mixed payments (cash + transfer)", async () => {
    const total = productA.priceCents * 2 + productB.priceCents;
    const result = await processSaleOperation(
      cashierContext(),
      envelope(
        "SALE",
        salePayload({
          payments: [
            { method: "CASH", amountCents: Math.floor(total / 2) },
            { method: "TRANSFER", amountCents: total - Math.floor(total / 2) }
          ]
        })
      )
    );
    expect(result.status).toBe("ACCEPTED");
  });

  it("rejects an operation from another branch scope", async () => {
    const op = envelope("SALE", salePayload());
    const foreign = { ...op, branchId: fixtures.branchB.id };
    await expect(processSaleOperation(cashierContext(), foreign)).rejects.toThrow("FORBIDDEN_BRANCH_SCOPE");
  });

  it("rejects an unknown product in the branch", async () => {
    const result = await processSaleOperation(
      cashierContext(),
      envelope(
        "SALE",
        salePayload({
          lines: [{ productId: crypto.randomUUID(), quantity: "1", priceCents: 1000 }],
          payments: [{ method: "CASH", amountCents: 1000 }]
        })
      )
    );
    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_PRODUCT");
  });
});
