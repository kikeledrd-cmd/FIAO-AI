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

  it("applies REVERSAL and STOCK_ADJUSTMENT deltas to the local catalog", async () => {    const productId = "55555555-5555-4555-8555-555555555555";
    await db.catalog.put({
      productId,
      ownerId,
      branchId,
      name: "Arroz",
      barcode: null,
      priceCents: 5500,
      stockControl: true,
      unitLabel: "und",
      onHand: "8",
      active: true
    });
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "0" })),
      pull: vi.fn(async () => ({
        changes: [
          {
            cursor: "1",
            ownerId,
            branchId,
            type: "REVERSAL",
            payload: {
              reversalId: "66666666-6666-4666-8666-666666666666",
              saleId: "77777777-7777-4777-8777-777777777777",
              lines: [{ productId, quantity: "2" }],
              reason: "Devolución",
              fiadoReversedCents: 0,
              occurredAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          },
          {
            cursor: "2",
            ownerId,
            branchId,
            type: "STOCK_ADJUSTMENT",
            payload: {
              adjustmentId: "88888888-8888-4888-8888-888888888888",
              productId,
              quantityDelta: "-1",
              reason: "Merma",
              onHandAfter: "9",
              occurredAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          }
        ],
        nextCursor: "2",
        hasMore: false
      }))
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });
    const summary = await client.syncNow(branchId);

    expect(summary.pulled).toBe(2);
    const row = await db.catalog.get(productId);
    expect(row?.onHand).toBe("9"); // 8 + 2 (REVERSAL) − 1 (STOCK_ADJUSTMENT)
  });

  it("applies PURCHASE deltas (stock + cost) and SUPPLIER deltas to the local replica", async () => {
    const productId = "55555555-5555-4555-8555-555555555555";
    await db.catalog.put({
      productId,
      ownerId,
      branchId,
      name: "Arroz",
      barcode: null,
      priceCents: 11000,
      costCents: 8000,
      stockControl: true,
      unitLabel: "und",
      onHand: "10",
      active: true
    });
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "0" })),
      pull: vi.fn(async () => ({
        changes: [
          {
            cursor: "1",
            ownerId,
            branchId,
            type: "PURCHASE",
            payload: {
              purchaseId: "99999999-9999-4999-8999-999999999999",
              supplierId: null,
              lines: [{ productId, quantity: "5", unitCostCents: 7000 }],
              costAfter: [{ productId, costCents: 7750 }],
              note: null,
              totalCents: 35000,
              occurredAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          },
          {
            cursor: "2",
            ownerId,
            branchId,
            type: "SUPPLIER",
            payload: {
              supplierId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "Distribuidora La Vega",
              phoneE164: "+18095551111",
              active: true
            },
            createdAt: new Date().toISOString()
          }
        ],
        nextCursor: "2",
        hasMore: false
      }))
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });
    const summary = await client.syncNow(branchId);

    expect(summary.pulled).toBe(2);
    const row = await db.catalog.get(productId);
    expect(row?.onHand).toBe("15");
    expect(row?.costCents).toBe(7750);
    const supplier = await db.suppliers.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(supplier?.name).toBe("Distribuidora La Vega");
  });

  it("applies CASH deltas (session + movements) to the local replica", async () => {
    const transport: SyncTransport = {
      push: vi.fn(async () => ({ results: [], cursor: "0" })),
      pull: vi.fn(async () => ({
        changes: [
          {
            cursor: "1",
            ownerId,
            branchId,
            type: "CASH_OPEN",
            payload: {
              sessionId: "77777777-7777-4777-8777-777777777777",
              branchId,
              openingFloatCents: 200000,
              openedAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          },
          {
            cursor: "2",
            ownerId,
            branchId,
            type: "CASH_EXPENSE",
            payload: {
              movementId: "88888888-8888-4888-8888-888888888888",
              sessionId: "77777777-7777-4777-8777-777777777777",
              type: "EXPENSE",
              amountCents: 50000,
              category: "Agua",
              description: "Botellón",
              reason: null,
              occurredAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          },
          {
            cursor: "3",
            ownerId,
            branchId,
            type: "CASH_CLOSE",
            payload: {
              sessionId: "77777777-7777-4777-8777-777777777777",
              countedCents: 150000,
              expectedCents: 150000,
              differenceCents: 0,
              closedAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString()
          }
        ],
        nextCursor: "3",
        hasMore: false
      }))
    };
    const client = createSyncClient({ database: db, transport, sleep: async () => {} });
    const summary = await client.syncNow(branchId);

    expect(summary.pulled).toBe(3);
    const session = await db.cashSessions.get("77777777-7777-4777-8777-777777777777");
    expect(session?.status).toBe("CLOSED");
    expect(session?.openingFloatCents).toBe(200000);
    expect(session?.countedCents).toBe(150000);
    expect(session?.differenceCents).toBe(0);
    const movement = await db.cashMovements.get("88888888-8888-4888-8888-888888888888");
    expect(movement?.type).toBe("EXPENSE");
    expect(movement?.amountCents).toBe(50000);
  });
});
