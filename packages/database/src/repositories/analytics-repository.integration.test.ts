import { databaseClient } from "@fiao/database/client";
import { AnalyticsRepository } from "@fiao/database/repositories/analytics-repository";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();
const repository = new AnalyticsRepository();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
});

beforeEach(async () => {
  const ownerId = fixtures.owner.id;
  await databaseClient.pilotEvent.deleteMany({ where: { ownerId } });
  await databaseClient.aiAuditLog.deleteMany({ where: { ownerId } });
  await databaseClient.syncConflict.deleteMany({ where: { ownerId } });
  await databaseClient.order.deleteMany({ where: { ownerId } });
  await databaseClient.cashSession.deleteMany({ where: { ownerId } });
  await databaseClient.stockMovement.deleteMany({ where: { ownerId } });
  await databaseClient.creditMovement.deleteMany({ where: { ownerId } });
  await databaseClient.sale.deleteMany({ where: { ownerId } });
});

describe("AnalyticsRepository", () => {
  it("registra eventos append-only y cuenta logins en 7 días", async () => {
    await repository.record({ ownerId: fixtures.owner.id, branchId: fixtures.branchA.id, eventName: "USER_LOGIN" });
    await repository.record({ ownerId: fixtures.owner.id, branchId: fixtures.branchA.id, eventName: "SYNC_CONFLICT", metadata: { operationId: "op-1" } });

    const summary = await repository.summary(fixtures.owner.id);

    expect(summary.loginCount7d).toBe(1);
    expect(summary.syncConflictCount).toBe(0); // PilotEvent ≠ SyncConflict (el repo suma la tabla SyncConflict)
    expect(summary.salesCount).toBe(0);
    expect(summary.firstSaleAt).toBeNull();
  });

  it("computa ventas, fiado y días activos desde los ledgers", async () => {
    const branchId = fixtures.branchA.id;
    await databaseClient.sale.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        saleId: crypto.randomUUID(),
        actorUserId: fixtures.ownerUser.id,
        deviceId: (await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id)).id,
        lines: [],
        payments: [{ method: "CASH", amountCents: 1000 }],
        subtotalCents: 1000,
        totalCents: 1000,
        occurredAt: new Date()
      }
    });
    const customer = await databaseClient.customer.create({
      data: { ownerId: fixtures.owner.id, branchId, customerId: crypto.randomUUID(), name: "Cliente" }
    });
    await databaseClient.creditMovement.create({
      data: { ownerId: fixtures.owner.id, branchId, customerId: customer.id, type: "FIAO_SALE", amountCents: 5000, occurredAt: new Date() }
    });
    await databaseClient.creditMovement.create({
      data: { ownerId: fixtures.owner.id, branchId, customerId: customer.id, type: "ABONO", amountCents: 2000, occurredAt: new Date() }
    });

    const summary = await repository.summary(fixtures.owner.id);

    expect(summary.firstSaleAt).not.toBeNull();
    expect(summary.salesCount).toBe(1);
    expect(summary.salesToday).toBe(1);
    expect(summary.fiadoRecordedCents).toBe(5000);
    expect(summary.collectionsCents).toBe(2000);
    expect(summary.activeDays7).toBe(1);
  });

  it("cuenta diferencias de caja y ajustes de stock", async () => {
    const branchId = fixtures.branchA.id;
    const device = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id);
    await databaseClient.cashSession.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        sessionId: crypto.randomUUID(),
        status: "CLOSED",
        openedById: fixtures.ownerUser.id,
        openedAt: new Date(),
        openingFloatCents: 10000,
        countedCents: 9500,
        differenceCents: -500
      }
    });
    await databaseClient.product.create({
      data: { ownerId: fixtures.owner.id, branchId, name: "P1", priceCents: 100, costCents: 50 }
    });
    const product = await databaseClient.product.findFirst({ where: { branchId }, select: { id: true } });
    await databaseClient.stockMovement.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        productId: product!.id,
        type: "ADJUSTMENT",
        quantityDelta: "5"
      }
    });

    const summary = await repository.summary(fixtures.owner.id);

    expect(summary.cashCloseDifferenceCount).toBe(1);
    expect(summary.stockAdjustmentCount).toBe(1);
  });

  it("computa métricas de WhatsApp y AI", async () => {
    const branchId = fixtures.branchA.id;
    const device = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id);
    await databaseClient.order.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        orderId: crypto.randomUUID(),
        source: "WHATSAPP",
        status: "PREPARING",
        actorUserId: fixtures.ownerUser.id,
        deviceId: device.id,
        lines: [],
        totalCents: 0,
        occurredAt: new Date()
      }
    });
    await databaseClient.order.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        orderId: crypto.randomUUID(),
        source: "WHATSAPP",
        status: "NEW",
        exceptionReason: "AMBIGUOUS_ITEMS",
        actorUserId: fixtures.ownerUser.id,
        deviceId: device.id,
        lines: [],
        totalCents: 0,
        occurredAt: new Date()
      }
    });
    await databaseClient.aiAuditLog.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        actorUserId: fixtures.ownerUser.id,
        actorRole: "OWNER",
        commandText: "¿cuánto vendí?",
        intentKind: "QUERY",
        intentTool: "SALES"
      }
    });
    await databaseClient.aiAuditLog.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId,
        actorUserId: fixtures.ownerUser.id,
        actorRole: "OWNER",
        commandText: "abona 100 a maría",
        intentKind: "ACTION",
        intentTool: "ABONO"
      }
    });

    const summary = await repository.summary(fixtures.owner.id);

    expect(summary.whatsappOrdersCount).toBe(2);
    expect(summary.whatsappAutoAcceptedCount).toBe(1);
    expect(summary.whatsappExceptionCount).toBe(1);
    expect(summary.aiQueryCount).toBe(1);
    expect(summary.aiActionCount).toBe(1);
  });
});
