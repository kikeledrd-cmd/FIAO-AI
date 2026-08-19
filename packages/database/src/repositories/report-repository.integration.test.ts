import { databaseClient } from "@fiao/database/client";
import { ReportRepository } from "@fiao/database/repositories/report-repository";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();
const repository = new ReportRepository();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerDevice: { id: string };

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Celular del dueño");
});

beforeEach(async () => {
  const branchId = fixtures.branchA.id;
  await databaseClient.creditMovement.deleteMany({ where: { branchId } });
  await databaseClient.sale.deleteMany({ where: { branchId } });
  await databaseClient.customer.deleteMany({ where: { branchId } });
  await databaseClient.productStock.deleteMany({ where: { branchId } });
  await databaseClient.product.deleteMany({ where: { branchId } });
});

async function seedProduct(opts: { costCents?: number; onHand?: string; stockControl?: boolean } = {}) {
  const product = await factory.createProduct(fixtures.branchA, {
    onHand: opts.onHand ?? "10",
    stockControl: opts.stockControl ?? true
  });
  if (opts.costCents !== undefined) {
    await databaseClient.product.update({ where: { id: product.id }, data: { costCents: opts.costCents } });
  }
  return product;
}

async function seedSale(opts: {
  productId: string;
  quantity?: string;
  subtotalCents?: number;
  totalCents?: number;
  payments?: Array<{ method: string; amountCents: number }>;
  occurredAt?: Date;
}) {
  return databaseClient.sale.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      saleId: crypto.randomUUID(),
      actorUserId: fixtures.ownerUser.id,
      deviceId: ownerDevice.id,
      lines: [{ productId: opts.productId, quantity: opts.quantity ?? "1" }],
      payments: opts.payments ?? [{ method: "CASH", amountCents: opts.totalCents ?? opts.subtotalCents ?? 1000 }],
      subtotalCents: opts.subtotalCents ?? 1000,
      totalCents: opts.totalCents ?? opts.subtotalCents ?? 1000,
      discountCents: 0,
      occurredAt: opts.occurredAt ?? new Date()
    }
  });
}

async function seedCustomer(name = "Cliente Test") {
  return databaseClient.customer.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      customerId: crypto.randomUUID(),
      name,
      creditLimitCents: 100_00
    }
  });
}

async function seedCredit(customerId: string, type: "FIAO_SALE" | "ABONO", amountCents: number, occurredAt = new Date()) {
  return databaseClient.creditMovement.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      customerId,
      type,
      amountCents,
      occurredAt
    }
  });
}

describe("ReportRepository", () => {
  it("computa el dashboard reconciliado (ventas, ganancia, fiado, stock bajo)", async () => {
    const product = await seedProduct({ costCents: 2000, onHand: "2" });
    await seedSale({ productId: product.id, quantity: "2", subtotalCents: 100_00, totalCents: 100_00, payments: [{ method: "CASH", amountCents: 100_00 }] });
    const customer = await seedCustomer();
    await seedCredit(customer.id, "FIAO_SALE", 50_00);

    const dashboard = await repository.dashboard(fixtures.owner.id, fixtures.branchA.id);

    expect(dashboard.label).toBe("CONFIRMED");
    expect(dashboard.salesTodayCents).toBe(100_00);
    expect(dashboard.estimatedProfitCents).toBe(100_00 - 2 * 2000);
    expect(dashboard.totalFiadoCents).toBe(50_00);
    expect(dashboard.lowStockCount).toBe(1);
    expect(dashboard.cashOpen).toBe(false);
  });

  it("desglosa las ventas por método de pago", async () => {
    const product = await seedProduct();
    await seedSale({
      productId: product.id,
      subtotalCents: 100_00,
      totalCents: 100_00,
      payments: [
        { method: "CASH", amountCents: 60_00 },
        { method: "TRANSFER", amountCents: 40_00 }
      ]
    });

    const report = await repository.sales(fixtures.owner.id, fixtures.branchA.id);

    expect(report.totalCents).toBe(100_00);
    expect(report.count).toBe(1);
    expect(report.cashCents).toBe(60_00);
    expect(report.transferCents).toBe(40_00);
    expect(report.fiadoCents).toBe(0);
  });

  it("estima la ganancia desde subtotal y costo promedio", async () => {
    const product = await seedProduct({ costCents: 3000 });
    await seedSale({ productId: product.id, quantity: "3", subtotalCents: 150_00, totalCents: 150_00 });

    const report = await repository.profit(fixtures.owner.id, fixtures.branchA.id);

    expect(report.label).toBe("ESTIMATED");
    expect(report.revenueCents).toBe(150_00);
    expect(report.costCents).toBe(9000);
    expect(report.profitCents).toBe(150_00 - 9000);
  });

  it("calcula el fiado neto y los clientes con deuda", async () => {
    const customer = await seedCustomer();
    await seedCredit(customer.id, "FIAO_SALE", 80_00);
    await seedCredit(customer.id, "ABONO", 30_00);

    const report = await repository.fiao(fixtures.owner.id, fixtures.branchA.id);

    expect(report.totalFiadoCents).toBe(50_00);
    expect(report.customersWithDebt).toBe(1);
  });

  it("lista clientes con deuda y total fiado", async () => {
    const customer = await seedCustomer("Juan Pérez");
    await seedCredit(customer.id, "FIAO_SALE", 70_00);

    const report = await repository.customers(fixtures.owner.id, fixtures.branchA.id);

    expect(report.totalCustomers).toBe(1);
    expect(report.activeCustomers).toBe(1);
    expect(report.withDebt).toBe(1);
    expect(report.topDebtors).toHaveLength(1);
    expect(report.topDebtors[0]?.name).toBe("Juan Pérez");
    expect(report.topDebtors[0]?.balanceCents).toBe(70_00);
  });

  it("exporta ventas a filas CSV con nombre de cliente", async () => {
    const product = await seedProduct();
    const customer = await seedCustomer("María");
    await seedSale({ productId: product.id, subtotalCents: 50_00, totalCents: 50_00, payments: [{ method: "CASH", amountCents: 50_00 }] });
    await databaseClient.sale.updateMany({
      where: { branchId: fixtures.branchA.id },
      data: { customerId: customer.id }
    });

    const rows = await repository.exportSales(fixtures.owner.id, fixtures.branchA.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalCents).toBe(50_00);
    expect(rows[0]?.customerName).toBe("María");
    expect(rows[0]?.cashCents).toBe(50_00);
  });

  it("exporta clientes con saldo y marca booleana como 0/1", async () => {
    const customer = await seedCustomer("Pedro");
    await seedCredit(customer.id, "FIAO_SALE", 40_00);

    const rows = await repository.exportCustomers(fixtures.owner.id, fixtures.branchA.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Pedro");
    expect(rows[0]?.balanceCents).toBe(40_00);
    expect(rows[0]?.active).toBe(1);
  });

  it("exporta productos con costo y control de stock como 0/1", async () => {
    await seedProduct({ costCents: 1500, onHand: "5" });

    const rows = await repository.exportProducts(fixtures.owner.id, fixtures.branchA.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.costCents).toBe(1500);
    expect(rows[0]?.stockControl).toBe(1);
    expect(rows[0]?.onHand).toBe("5");
  });

  it("reporta caja cerrada sin sesión abierta", async () => {
    const report = await repository.cash(fixtures.owner.id, fixtures.branchA.id);

    expect(report.openSessionId).toBeNull();
    expect(report.expectedCents).toBeNull();
  });
});
