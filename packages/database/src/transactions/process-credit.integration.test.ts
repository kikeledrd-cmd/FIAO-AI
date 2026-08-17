import type { AbonoPayload, CustomerUpsertPayload } from "@fiao/contracts/credit";
import type { SaleOperationPayload } from "@fiao/contracts/sales";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processAbonoOperation } from "@fiao/database/transactions/process-abono";
import { processCustomerUpsert } from "@fiao/database/transactions/process-customer";
import { processSaleOperation } from "@fiao/database/transactions/process-sale";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let device: { id: string };
let productA: { id: string; priceCents: number };
let customer: CustomerUpsertPayload;

function context(): CommandContext {
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

function customerPayload(overrides: Partial<CustomerUpsertPayload> = {}): CustomerUpsertPayload {
  return {
    customerId: crypto.randomUUID(),
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    name: "Doña María",
    phoneE164: "+18095550001",
    creditLimitCents: 100000,
    defaultPromiseDays: 7,
    active: true,
    ...overrides
  };
}

function fiadoSalePayload(overrides: Partial<SaleOperationPayload> = {}): SaleOperationPayload {
  return {
    saleId: crypto.randomUUID(),
    customerId: customer.customerId,
    lines: [{ productId: productA.id, quantity: "1", priceCents: productA.priceCents }],
    payments: [{ method: "FIADO", amountCents: productA.priceCents }],
    ...overrides
  };
}

function abonoPayload(overrides: Partial<AbonoPayload> = {}): AbonoPayload {
  return {
    abonoId: crypto.randomUUID(),
    customerId: customer.customerId,
    amountCents: 5000,
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

async function balanceCents(customerPublicId: string): Promise<number> {
  const customer = await databaseClient.customer.findUniqueOrThrow({ where: { customerId: customerPublicId }, select: { id: true } });
  const rows = await databaseClient.creditMovement.findMany({
    where: { branchId: fixtures.branchA.id, customerId: customer.id },
    select: { type: true, amountCents: true }
  });
  return rows.reduce((sum, row) => sum + (row.type === "FIAO_SALE" ? row.amountCents : -row.amountCents), 0);
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  device = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "POS de prueba");
  productA = await factory.createProduct(fixtures.branchA, { name: "Arroz", priceCents: 5500, onHand: "10" });
});

beforeEach(async () => {
  await databaseClient.productStock.update({ where: { productId: productA.id }, data: { onHand: "10" } });
  // Orden respetando FK Restrict hacia clientOperation.
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.loyaltyMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.stockMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.creditMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.customer.deleteMany({ where: { branchId: fixtures.branchA.id } });
});

describe("processCustomerUpsert", () => {
  it("creates a customer idempotently", async () => {
    const payload = customerPayload();
    const first = await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", payload));
    const retry = await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", payload));

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    const rows = await databaseClient.customer.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(rows).toHaveLength(1);
  });

  it("updates an existing customer by customerId", async () => {
    const payload = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", payload));
    const updated = await processCustomerUpsert(
      context(),
      envelope("CUSTOMER_UPSERT", { ...payload, name: "Doña María R.", creditLimitCents: 200000 })
    );

    expect(updated.status).toBe("ACCEPTED");
    const row = await databaseClient.customer.findUniqueOrThrow({ where: { customerId: payload.customerId } });
    expect(row.name).toBe("Doña María R.");
    expect(row.creditLimitCents).toBe(200000);
  });
});

describe("processSaleOperation with FIADO", () => {
  it("accepts a fiado sale and creates a credit charge", async () => {
    customer = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    const result = await processSaleOperation(context(), envelope("SALE", fiadoSalePayload()));

    expect(result.status).toBe("ACCEPTED");
    expect(await balanceCents(customer.customerId)).toBe(productA.priceCents);
    const movements = await databaseClient.creditMovement.findMany({ where: { branchId: fixtures.branchA.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe("FIAO_SALE");
  });

  it("rejects a fiado sale without a customerId", async () => {
    customer = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    const result = await processSaleOperation(context(), envelope("SALE", fiadoSalePayload({ customerId: undefined })));

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("FIADO_REQUIRES_CUSTOMER");
  });

  it("rejects a fiado sale when the credit limit is exceeded", async () => {
    customer = customerPayload({ creditLimitCents: 1000 });
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    const result = await processSaleOperation(context(), envelope("SALE", fiadoSalePayload()));

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("CREDIT_LIMIT_EXCEEDED");
  });

  it("rejects a fiado sale for an unknown customer", async () => {
    customer = customerPayload();
    const result = await processSaleOperation(context(), envelope("SALE", fiadoSalePayload()));

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_CUSTOMER");
  });

  it("accepts a mixed cash + fiado sale", async () => {
    customer = customerPayload({ creditLimitCents: 20000 });
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    const payload = fiadoSalePayload({
      lines: [{ productId: productA.id, quantity: "2", priceCents: productA.priceCents }],
      payments: [
        { method: "CASH", amountCents: productA.priceCents },
        { method: "FIADO", amountCents: productA.priceCents }
      ]
    });
    const result = await processSaleOperation(context(), envelope("SALE", payload));

    expect(result.status).toBe("ACCEPTED");
    expect(await balanceCents(customer.customerId)).toBe(productA.priceCents);
  });
});

describe("processAbonoOperation", () => {
  it("accepts an abono and reduces the balance", async () => {
    customer = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    await processSaleOperation(context(), envelope("SALE", fiadoSalePayload({ saleId: crypto.randomUUID() })));

    const abono = abonoPayload({ amountCents: productA.priceCents });
    const result = await processAbonoOperation(context(), envelope("ABONO", abono));

    expect(result.status).toBe("ACCEPTED");
    expect(await balanceCents(customer.customerId)).toBe(0);
  });

  it("rejects an abono that exceeds the balance", async () => {
    customer = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    await processSaleOperation(context(), envelope("SALE", fiadoSalePayload({ saleId: crypto.randomUUID() })));

    const abono = abonoPayload({ amountCents: productA.priceCents * 2 });
    const result = await processAbonoOperation(context(), envelope("ABONO", abono));

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("ABONO_EXCEEDS_BALANCE");
    expect(await balanceCents(customer.customerId)).toBe(productA.priceCents);
  });

  it("is idempotent on retry", async () => {
    customer = customerPayload();
    await processCustomerUpsert(context(), envelope("CUSTOMER_UPSERT", customer));
    await processSaleOperation(context(), envelope("SALE", fiadoSalePayload({ saleId: crypto.randomUUID() })));

    const abono = abonoPayload();
    const envelopeForAbono = envelope("ABONO", abono);
    const first = await processAbonoOperation(context(), envelopeForAbono);
    const retry = await processAbonoOperation(context(), envelopeForAbono);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    expect(await balanceCents(customer.customerId)).toBe(productA.priceCents - abono.amountCents);
    const movements = await databaseClient.creditMovement.count({ where: { branchId: fixtures.branchA.id } });
    expect(movements).toBe(2); // 1 FIAO_SALE + 1 ABONO (sin duplicar)
  });
});
