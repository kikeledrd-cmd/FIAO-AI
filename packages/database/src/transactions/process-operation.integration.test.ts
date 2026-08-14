import { beforeEach, describe, expect, it } from "vitest";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { resetDatabase, testDb } from "@fiao/testkit/db";
import { TestFactory } from "@fiao/testkit/factories";
import { processOperation } from "./process-operation";

const factory = new TestFactory(testDb);

async function fixture() {
  const first = await factory.ownerWithTwoBranchesAndCashier();
  const device = await factory.createDeviceForUser(first.owner.id, first.ownerUser.id, "Owner phone");
  const context: CommandContext = {
    ownerId: first.owner.id,
    branchId: first.branchA.id,
    userId: first.ownerUser.id,
    role: "OWNER",
    deviceId: device.id,
    now: new Date()
  };
  const operation: ClientOperationEnvelope = {
    operationId: crypto.randomUUID(),
    type: "NOOP",
    ownerId: context.ownerId,
    branchId: context.branchId,
    actorUserId: context.userId,
    deviceId: context.deviceId,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload: { reason: "foundation-test" }
  };
  return { first, context, operation };
}

describe("processOperation", () => {
  beforeEach(async () => resetDatabase());

  it("accepts the same operation only once", async () => {
    const { context, operation } = await fixture();
    const first = await processOperation(context, operation, testDb);
    const second = await processOperation(context, operation, testDb);

    expect(first).toEqual(second);
    expect(first.status).toBe("ACCEPTED");
    expect(await testDb.clientOperation.count({ where: { operationId: operation.operationId } })).toBe(1);
    expect(await testDb.syncChange.count({ where: { clientOperation: { operationId: operation.operationId } } })).toBe(1);
  });

  it("rejects an envelope that spoofs another owner", async () => {
    const { context, operation } = await fixture();
    const other = await factory.ownerWithTwoBranchesAndCashier();

    await expect(processOperation(context, { ...operation, ownerId: other.owner.id }, testDb))
      .rejects.toThrow("FORBIDDEN_OWNER_SCOPE");
    expect(await testDb.clientOperation.count()).toBe(0);
  });

  it("rejects actor and device scope spoofing before persistence", async () => {
    const { context, operation } = await fixture();
    await expect(processOperation(context, { ...operation, actorUserId: crypto.randomUUID() }, testDb))
      .rejects.toThrow("FORBIDDEN_ACTOR_SCOPE");
    await expect(processOperation(context, { ...operation, deviceId: crypto.randomUUID() }, testDb))
      .rejects.toThrow("FORBIDDEN_DEVICE_SCOPE");
    expect(await testDb.clientOperation.count()).toBe(0);
  });
});
