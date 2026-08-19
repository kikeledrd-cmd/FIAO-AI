import { databaseClient } from "@fiao/database/client";
import { DeviceRepository, OnboardingRepository, SettingsRepository } from "@fiao/database/repositories/settings-repository";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();
const settingsRepository = new SettingsRepository();
const onboardingRepository = new OnboardingRepository();
const deviceRepository = new DeviceRepository();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
});

beforeEach(async () => {
  const branchId = fixtures.branchA.id;
  await databaseClient.onboardingState.deleteMany({ where: { branchId } });
  await databaseClient.businessSettings.deleteMany({ where: { branchId } });
  await databaseClient.session.deleteMany({ where: { ownerId: fixtures.owner.id } });
  await databaseClient.customer.deleteMany({ where: { branchId } });
  await databaseClient.sale.deleteMany({ where: { branchId } });
  await databaseClient.cashSession.deleteMany({ where: { branchId } });
  await databaseClient.productStock.deleteMany({ where: { branchId } });
  await databaseClient.product.deleteMany({ where: { branchId } });
});

describe("SettingsRepository", () => {
  it("crea la configuración default al leer por primera vez", async () => {
    const settings = await settingsRepository.getByBranch(fixtures.owner.id, fixtures.branchA.id);

    expect(settings.branchId).toBe(fixtures.branchA.id);
    expect(settings.defaultPromiseDays).toBe(7);
    expect(settings.lowStockThreshold).toBe(3);
    expect(settings.cashierDiscountLimitCents).toBe(1000);
    expect(settings.whatsappRemindersEnabled).toBe(false);
  });

  it("actualiza solo los campos provistos", async () => {
    await settingsRepository.update(fixtures.owner.id, fixtures.branchA.id, { defaultPromiseDays: 15 });

    const settings = await settingsRepository.getByBranch(fixtures.owner.id, fixtures.branchA.id);

    expect(settings.defaultPromiseDays).toBe(15);
    expect(settings.lowStockThreshold).toBe(3);
    expect(settings.whatsappRemindersEnabled).toBe(false);
  });
});

describe("OnboardingRepository", () => {
  it("reporta solo BRANCH_CREATED en una sucursal vacía", async () => {
    const state = await onboardingRepository.getState(fixtures.owner.id, fixtures.branchA.id);

    expect(state.completed).toEqual(["BRANCH_CREATED"]);
    expect(state.next).toBe("CATALOG_LOADED");
    expect(state.total).toBe(5);
  });

  it("avanza milestones con catálogo, cliente y venta", async () => {
    await factory.createProduct(fixtures.branchA, { onHand: "10" });
    await databaseClient.customer.create({
      data: { ownerId: fixtures.owner.id, branchId: fixtures.branchA.id, customerId: crypto.randomUUID(), name: "Cliente" }
    });

    const state = await onboardingRepository.getState(fixtures.owner.id, fixtures.branchA.id);

    expect(state.completed).toEqual(["BRANCH_CREATED", "CATALOG_LOADED", "CUSTOMER_CREATED"]);
    expect(state.next).toBe("CASH_OPENED");
  });
});

describe("DeviceRepository", () => {
  it("lista y revoca dispositivos invalidando sesiones", async () => {
    const device = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "POS 1");
    await databaseClient.session.create({
      data: {
        ownerId: fixtures.owner.id,
        userId: fixtures.ownerUser.id,
        deviceId: device.id,
        tokenHash: crypto.randomUUID().replace(/-/g, ""),
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });

    const listed = await deviceRepository.listByOwner(fixtures.owner.id);
    expect(listed.some((entry) => entry.id === device.id && entry.active)).toBe(true);

    const revoked = await deviceRepository.revoke(fixtures.owner.id, device.id);
    expect(revoked).toBe(true);

    const after = await deviceRepository.listByOwner(fixtures.owner.id);
    expect(after.find((entry) => entry.id === device.id)?.active).toBe(false);

    const session = await databaseClient.session.findFirst({ where: { deviceId: device.id } });
    expect(session?.revokedAt).not.toBeNull();
  });

  it("no revoca un dispositivo ajeno", async () => {
    const revoked = await deviceRepository.revoke(fixtures.owner.id, crypto.randomUUID());
    expect(revoked).toBe(false);
  });
});
