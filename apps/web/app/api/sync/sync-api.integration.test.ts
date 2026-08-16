import { beforeEach, describe, expect, it } from "vitest";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { processOperation, SyncRepository } from "@fiao/database";
import { resetDatabase, testDb } from "@fiao/testkit/db";
import { TestFactory } from "@fiao/testkit/factories";
import { createPullHandler } from "./pull/handler";
import { createPushHandler } from "./push/handler";

const factory = new TestFactory(testDb);

async function setup() {
  const tenant = await factory.ownerWithTwoBranchesAndCashier();
  const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id, "Owner phone");
  const context: CommandContext = {
    ownerId: tenant.owner.id,
    branchId: tenant.branchA.id,
    userId: tenant.ownerUser.id,
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
    payload: { smoke: true }
  };
  const repository = new SyncRepository(testDb);
  const loadBranchContext = async (branchId: string) => {
    if (branchId !== context.branchId) throw new Error("FORBIDDEN");
    return context;
  };
  const push = createPushHandler({
    loadBranchContext,
    processOperation: (ctx, envelope) => processOperation(ctx, envelope, testDb),
    syncRepository: repository
  });
  const pull = createPullHandler({ loadBranchContext, syncRepository: repository });
  return { tenant, context, operation, push, pull };
}

function postBody(body: unknown) {
  return new Request("http://localhost/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("sync API", () => {
  beforeEach(async () => resetDatabase());

  it("pushes an operation then pulls its change exactly once", async () => {
    const { context, operation, push, pull } = await setup();
    const pushed = await push(postBody({ branchId: context.branchId, operations: [operation] }));
    expect(pushed.status).toBe(200);

    const firstPull = await pull(new Request(`http://localhost/api/sync/pull?branchId=${context.branchId}&after=0`));
    const firstBody = await firstPull.json();
    expect(firstBody.changes).toHaveLength(1);

    const secondPull = await pull(new Request(
      `http://localhost/api/sync/pull?branchId=${context.branchId}&after=${firstBody.nextCursor}`
    ));
    expect((await secondPull.json()).changes).toHaveLength(0);
  });

  it("keeps an exact batch retry idempotent", async () => {
    const { context, operation, push } = await setup();
    const body = { branchId: context.branchId, operations: [operation] };
    expect((await push(postBody(body))).status).toBe(200);
    expect((await push(postBody(body))).status).toBe(200);

    expect(await testDb.clientOperation.count({ where: { operationId: operation.operationId } })).toBe(1);
    expect(await testDb.syncChange.count({ where: { clientOperation: { operationId: operation.operationId } } })).toBe(1);
  });

  it("preflights the entire batch before writing when one envelope spoofs scope", async () => {
    const { context, operation, push } = await setup();
    const spoofed = { ...operation, operationId: crypto.randomUUID(), ownerId: crypto.randomUUID() };
    const response = await push(postBody({ branchId: context.branchId, operations: [operation, spoofed] }));

    expect(response.status).toBe(403);
    expect(await testDb.clientOperation.count()).toBe(0);
  });
});
