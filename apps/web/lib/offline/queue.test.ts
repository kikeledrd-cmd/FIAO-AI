import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FiaoOfflineDatabase } from "./db";
import { applySyncChanges, enqueueOperation, markOperationResult } from "./queue";

let db: FiaoOfflineDatabase;
const ownerId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  db = new FiaoOfflineDatabase(`fiao-test-${crypto.randomUUID()}`);
});
afterEach(async () => db.delete());

describe("offline queue", () => {
  it("keeps an operation pending until server acceptance", async () => {
    const op = await enqueueOperation({
      type: "NOOP",
      payload: { smoke: true },
      ownerId,
      branchId,
      actorUserId: "11111111-1111-4111-8111-111111111111",
      deviceId: "44444444-4444-4444-8444-444444444444"
    }, db);
    expect(await db.pendingOperations.get(op.operationId)).toBeTruthy();

    await markOperationResult({ operationId: op.operationId, status: "ACCEPTED", latestCursor: "10" }, db);
    expect(await db.pendingOperations.get(op.operationId)).toBeUndefined();
  });

  it("moves rejected operations into review storage", async () => {
    const op = await enqueueOperation({
      type: "NOOP",
      payload: {},
      ownerId,
      branchId,
      actorUserId: "11111111-1111-4111-8111-111111111111",
      deviceId: "44444444-4444-4444-8444-444444444444"
    }, db);
    await markOperationResult({
      operationId: op.operationId,
      status: "REJECTED",
      errorCode: "REVIEW_REQUIRED",
      latestCursor: "0"
    }, db);
    expect(await db.pendingOperations.get(op.operationId)).toBeUndefined();
    expect(await db.syncConflicts.where("operationId").equals(op.operationId).count()).toBe(1);
  });

  it("applies projection rows and cursor atomically", async () => {
    const changes = [{
      cursor: "10",
      ownerId,
      branchId,
      type: "NOOP",
      payload: { operationId: "11111111-1111-4111-8111-111111111111", type: "NOOP" },
      createdAt: new Date().toISOString()
    }];
    await applySyncChanges(changes, db);
    expect(await db.projectionRows.count()).toBe(1);
    expect((await db.syncMeta.get(branchId))?.cursor).toBe("10");
  });

  it("rolls back projection rows and cursor when a reducer fails", async () => {
    await db.syncMeta.put({ branchId, ownerId, cursor: "5", lastSyncAt: null, lastError: null });
    const changes = [
      {
        cursor: "6",
        ownerId,
        branchId,
        type: "NOOP",
        payload: { operationId: "11111111-1111-4111-8111-111111111111" },
        createdAt: new Date().toISOString()
      },
      {
        cursor: "7",
        ownerId,
        branchId,
        type: "NOOP",
        payload: {},
        createdAt: new Date().toISOString()
      }
    ];

    await expect(applySyncChanges(changes, db)).rejects.toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
    expect(await db.projectionRows.count()).toBe(0);
    expect((await db.syncMeta.get(branchId))?.cursor).toBe("5");
  });
});
