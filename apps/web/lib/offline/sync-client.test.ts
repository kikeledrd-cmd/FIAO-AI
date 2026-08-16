import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FiaoOfflineDatabase } from "./db";
import { enqueueOperation } from "./queue";
import { createSyncClient, type SyncTransport } from "./sync-client";

let db: FiaoOfflineDatabase;
const ownerId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  db = new FiaoOfflineDatabase(`sync-client-${crypto.randomUUID()}`);
  await db.branches.put({ id: branchId, ownerId, name: "Los Mina", timezone: "America/Santo_Domingo" });
});
afterEach(async () => db.delete());

async function pendingOperation() {
  return enqueueOperation({
    type: "NOOP",
    payload: { smoke: true },
    ownerId,
    branchId,
    actorUserId: "11111111-1111-4111-8111-111111111111",
    deviceId: "44444444-4444-4444-8444-444444444444"
  }, db);
}

describe("sync client", () => {
  it("does not drop pending operations when network fails", async () => {
    const op = await pendingOperation();
    const transport: SyncTransport = {
      push: vi.fn(async () => { throw new TypeError("network down"); }),
      pull: vi.fn()
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });

    await expect(client.syncNow(branchId)).rejects.toThrow("network down");
    expect(await db.pendingOperations.get(op.operationId)).toBeTruthy();
    expect(transport.push).toHaveBeenCalledTimes(2);
  });

  it("does not mutate pending operations when a push response is incomplete", async () => {
    const op = await pendingOperation();
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "1" })),
      pull: vi.fn()
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });

    await expect(client.syncNow(branchId)).rejects.toThrow("SYNC_MISSING_OPERATION_RESULT");
    expect(await db.pendingOperations.get(op.operationId)).toBeTruthy();
  });

  it("preserves an accepted conflict for user review", async () => {
    const op = await pendingOperation();
    const transport: SyncTransport = {
      push: vi.fn(async () => ({
        results: [{ operationId: op.operationId, status: "ACCEPTED_WITH_CONFLICT" as const, conflictId: "conflict-1", latestCursor: "1" }],
        cursor: "1"
      })),
      pull: vi.fn(async () => ({ changes: [], nextCursor: "0", hasMore: false }))
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });
    const summary = await client.syncNow(branchId);

    expect(summary.conflicts).toBe(1);
    expect(await db.pendingOperations.get(op.operationId)).toBeUndefined();
    expect(await db.syncConflicts.get("conflict-1")).toBeTruthy();
  });

  it("preserves the latest successfully applied cursor when a later pull page fails", async () => {
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "0" })),
      pull: vi.fn()
        .mockResolvedValueOnce({
          changes: [{ cursor: "1", ownerId, branchId, type: "NOOP", payload: { operationId: "op-1" }, createdAt: new Date().toISOString() }],
          nextCursor: "1",
          hasMore: true
        })
        .mockRejectedValue(new Error("fatal pull"))
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });

    await expect(client.syncNow(branchId)).rejects.toThrow("fatal pull");
    expect((await db.syncMeta.get(branchId))?.cursor).toBe("1");
    expect((await db.syncMeta.get(branchId))?.lastError).toBe("fatal pull");
  });

  it("pulls every page and advances the local cursor transactionally", async () => {
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "0" })),
      pull: vi.fn()
        .mockResolvedValueOnce({
          changes: [{ cursor: "1", ownerId, branchId, type: "NOOP", payload: { operationId: "op-1" }, createdAt: new Date().toISOString() }],
          nextCursor: "1",
          hasMore: true
        })
        .mockResolvedValueOnce({
          changes: [{ cursor: "2", ownerId, branchId, type: "NOOP", payload: { operationId: "op-2" }, createdAt: new Date().toISOString() }],
          nextCursor: "2",
          hasMore: false
        })
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });
    const summary = await client.syncNow(branchId);

    expect(summary.pulled).toBe(2);
    expect(summary.cursor).toBe("2");
    expect((await db.syncMeta.get(branchId))?.cursor).toBe("2");
  });
});
