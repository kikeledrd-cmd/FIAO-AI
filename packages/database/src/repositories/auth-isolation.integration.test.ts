import { AuthRepository } from "@fiao/database/repositories/auth-repository";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, describe, expect, it } from "vitest";

const factory = new TestFactory();
const repository = new AuthRepository();

let ownerA: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerB: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;

beforeAll(async () => {
  await resetDatabase();
  ownerA = await factory.ownerWithTwoBranchesAndCashier();
  ownerB = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(ownerA.cashier.id, ownerA.branchA.id);
  await factory.assignUserToBranch(ownerB.cashier.id, ownerB.branchA.id);
});

describe("aislamiento tenant/branch (fuzz)", () => {
  it("niega acceso a la sucursal de otro dueño", async () => {
    await expect(repository.verifyBranchAccess(ownerA.ownerUser.id, ownerB.branchA.id)).rejects.toThrow("FORBIDDEN");
    await expect(repository.verifyBranchAccess(ownerB.ownerUser.id, ownerA.branchA.id)).rejects.toThrow("FORBIDDEN");
  });

  it("niega acceso a un usuario de otro dueño", async () => {
    await expect(repository.verifyBranchAccess(ownerB.ownerUser.id, ownerA.branchB.id)).rejects.toThrow("FORBIDDEN");
  });

  it("niega acceso a una sucursal inexistente", async () => {
    await expect(repository.verifyBranchAccess(ownerA.ownerUser.id, crypto.randomUUID())).rejects.toThrow("FORBIDDEN");
  });

  it("niega acceso de cajero a una sucursal no asignada", async () => {
    // branchB de A no está asignada al cajero de A.
    await expect(repository.verifyBranchAccess(ownerA.cashier.id, ownerA.branchB.id)).rejects.toThrow("FORBIDDEN");
  });

  it("permite acceso del dueño a su sucursal y del cajero a la asignada", async () => {
    await expect(repository.verifyBranchAccess(ownerA.ownerUser.id, ownerA.branchA.id)).resolves.toMatchObject({
      ownerId: ownerA.owner.id,
      branchId: ownerA.branchA.id,
      role: "OWNER"
    });
    await expect(repository.verifyBranchAccess(ownerA.cashier.id, ownerA.branchA.id)).resolves.toMatchObject({
      ownerId: ownerA.owner.id,
      branchId: ownerA.branchA.id,
      role: "CASHIER"
    });
  });
});
