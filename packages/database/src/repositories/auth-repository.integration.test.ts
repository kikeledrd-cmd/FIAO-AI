import { beforeEach, describe, expect, it } from "vitest";
import { AuthRepository } from "./auth-repository";
import { resetDatabase, testDb } from "@fiao/testkit/db";
import { TestFactory } from "@fiao/testkit/factories";

const repo = new AuthRepository(testDb);
const factory = new TestFactory(testDb);

describe("AuthRepository branch isolation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prevents a cashier from accessing a branch outside the assignment", async () => {
    const { owner, branchA, branchB, cashier } = await factory.ownerWithTwoBranchesAndCashier();
    await factory.assignUserToBranch(cashier.id, branchA.id);

    await expect(repo.verifyBranchAccess(cashier.id, branchB.id)).rejects.toThrow("FORBIDDEN");
    await expect(repo.verifyBranchAccess(cashier.id, branchA.id)).resolves.toMatchObject({
      ownerId: owner.id,
      branchId: branchA.id,
      role: "CASHIER",
    });
  });

  it("does not expose a cross-owner branch assignment during cashier login", async () => {
    const first = await factory.ownerWithTwoBranchesAndCashier();
    const second = await factory.ownerWithTwoBranchesAndCashier();
    await factory.assignUserToBranch(first.cashier.id, first.branchA.id);
    await factory.assignUserToBranch(first.cashier.id, second.branchA.id);

    await expect(repo.findActiveUserByPhone(first.cashier.phoneE164)).resolves.toMatchObject({
      user: { id: first.cashier.id, ownerId: first.owner.id },
      branches: [{ id: first.branchA.id }]
    });
    await expect(repo.verifyBranchAccess(first.cashier.id, second.branchA.id)).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a session when the device belongs to another owner or user", async () => {
    const first = await factory.ownerWithTwoBranchesAndCashier();
    const second = await factory.ownerWithTwoBranchesAndCashier();
    const foreignDevice = await factory.createDeviceForUser(second.owner.id, second.ownerUser.id, "Foreign phone");

    await expect(repo.createSession({
      ownerId: first.owner.id,
      userId: first.ownerUser.id,
      deviceId: foreignDevice.id,
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000)
    })).rejects.toThrow("FORBIDDEN");
  });

  it("creates a session when owner, user, and device belong to the same active account", async () => {
    const first = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(first.owner.id, first.ownerUser.id, "Owner phone");
    const expiresAt = new Date(Date.now() + 60_000);

    await expect(repo.createSession({
      ownerId: first.owner.id,
      userId: first.ownerUser.id,
      deviceId: device.id,
      tokenHash: "b".repeat(64),
      expiresAt
    })).resolves.toMatchObject({ expiresAt });
  });

  it("fails closed for revoked and expired sessions", async () => {
    const first = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(first.owner.id, first.ownerUser.id, "Owner phone");
    const tokenHash = "c".repeat(64);
    await repo.createSession({
      ownerId: first.owner.id,
      userId: first.ownerUser.id,
      deviceId: device.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000)
    });

    await expect(repo.findActiveSessionByTokenHash(tokenHash, new Date())).resolves.toMatchObject({
      ownerId: first.owner.id,
      userId: first.ownerUser.id,
      deviceId: device.id
    });
    await repo.revokeSessionByTokenHash(tokenHash, new Date());
    await expect(repo.findActiveSessionByTokenHash(tokenHash, new Date())).resolves.toBeNull();

    const expiredHash = "d".repeat(64);
    await repo.createSession({
      ownerId: first.owner.id,
      userId: first.ownerUser.id,
      deviceId: device.id,
      tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 1)
    });
    await expect(repo.findActiveSessionByTokenHash(expiredHash, new Date())).resolves.toBeNull();
  });

  it("only accepts an active OWNER as the owner authorization authorizer", async () => {
    const first = await factory.ownerWithTwoBranchesAndCashier();
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await expect(repo.createOwnerAuthorization({
      ownerId: first.owner.id,
      branchId: first.branchA.id,
      authorizerUserId: first.cashier.id,
      purpose: "FIADO_LIMIT_OVERRIDE",
      targetOperationId: crypto.randomUUID(),
      expiresAt
    })).rejects.toThrow("FORBIDDEN");

    await expect(repo.createOwnerAuthorization({
      ownerId: first.owner.id,
      branchId: first.branchA.id,
      authorizerUserId: first.ownerUser.id,
      purpose: "FIADO_LIMIT_OVERRIDE",
      targetOperationId: crypto.randomUUID(),
      expiresAt
    })).resolves.toMatchObject({ expiresAt });
  });

  it("allows an active owner to access any active branch owned by the account", async () => {
    const { owner, branchA, branchB, ownerUser } = await factory.ownerWithTwoBranchesAndCashier();

    await expect(repo.verifyBranchAccess(ownerUser.id, branchA.id)).resolves.toMatchObject({
      ownerId: owner.id,
      branchId: branchA.id,
      role: "OWNER",
    });
    await expect(repo.verifyBranchAccess(ownerUser.id, branchB.id)).resolves.toMatchObject({
      ownerId: owner.id,
      branchId: branchB.id,
      role: "OWNER",
    });
  });
});
