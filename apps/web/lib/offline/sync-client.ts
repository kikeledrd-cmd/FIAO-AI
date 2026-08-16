import type { ClientOperationEnvelope, OperationResult, SyncChangeRecord } from "@fiao/contracts/sync";
import { ApiError, apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb } from "./db";
import { applySyncChanges, listPendingOperations, markOperationResult } from "./queue";
import { adjustLocalStock } from "./catalog";

export interface SyncSummary {
  pushed: number;
  accepted: number;
  conflicts: number;
  rejected: number;
  pulled: number;
  cursor: string;
}

export interface PushResponse {
  results: OperationResult[];
  cursor: string;
}

export interface PullResponse {
  changes: SyncChangeRecord[];
  nextCursor: string;
  hasMore: boolean;
}

export interface SyncTransport {
  push(branchId: string, operations: ClientOperationEnvelope[]): Promise<PushResponse>;
  pull(branchId: string, after: string): Promise<PullResponse>;
}

export interface SyncClient {
  syncNow(branchId: string): Promise<SyncSummary>;
}

const httpTransport: SyncTransport = {
  push: (branchId, operations) => apiJson<PushResponse>("/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchId, operations })
  }),
  pull: (branchId, after) => apiJson<PullResponse>(
    `/api/sync/pull?branchId=${encodeURIComponent(branchId)}&after=${encodeURIComponent(after)}&limit=500`
  )
};

export function createSyncClient(options?: {
  database?: FiaoOfflineDatabase;
  transport?: SyncTransport;
  sleep?: (ms: number) => Promise<void>;
}): SyncClient {
  const database = options?.database ?? offlineDb;
  const transport = options?.transport ?? httpTransport;
  const sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    async syncNow(branchId: string): Promise<SyncSummary> {
      const pending = await listPendingOperations(branchId, 100, database);
      const branch = await database.branches.get(branchId);
      const currentMeta = await database.syncMeta.get(branchId);
      const expectedOwnerId = branch?.ownerId ?? currentMeta?.ownerId ?? pending[0]?.ownerId;
      let accepted = 0;
      let conflicts = 0;
      let rejected = 0;

      try {
        if (pending.length > 0) {
          const pushResponse = await withOneRetry(() => transport.push(branchId, pending), sleep);
          assertCompletePushResults(pending, pushResponse.results);
          for (const result of pushResponse.results) {
            await markOperationResult(result, database);
            if (result.status === "ACCEPTED") accepted += 1;
            else if (result.status === "ACCEPTED_WITH_CONFLICT") conflicts += 1;
            else rejected += 1;
          }
        }

        let cursor = currentMeta?.cursor ?? "0";
        let pulled = 0;
        for (;;) {
          const response = await withOneRetry(() => transport.pull(branchId, cursor), sleep);
          assertPullScope(response.changes, branchId, expectedOwnerId);
          assertCursorProgress(cursor, response.nextCursor, response.hasMore);
          await applySyncChanges(response.changes, database);
          await applySaleDeltasToLocalCatalog(response.changes, database);
          pulled += response.changes.length;
          cursor = response.nextCursor;
          if (!response.hasMore) break;
        }

        return { pushed: pending.length, accepted, conflicts, rejected, pulled, cursor };
      } catch (error) {
        await recordSyncError(branchId, expectedOwnerId, currentMeta?.cursor ?? "0", error, database);
        throw error;
      }
    }
  };
}

export const syncNow = createSyncClient().syncNow;

async function withOneRetry<T>(operation: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransient(error)) throw error;
    await sleep(250);
    return operation();
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof ApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return false;
}

function assertCompletePushResults(pending: ClientOperationEnvelope[], results: OperationResult[]): void {
  const expected = new Set(pending.map((operation) => operation.operationId));
  const seen = new Set<string>();
  for (const result of results) {
    if (!expected.has(result.operationId)) throw new Error("SYNC_UNKNOWN_OPERATION_RESULT");
    if (seen.has(result.operationId)) throw new Error("SYNC_DUPLICATE_OPERATION_RESULT");
    seen.add(result.operationId);
  }
  if (seen.size !== expected.size) throw new Error("SYNC_MISSING_OPERATION_RESULT");
}

function assertCursorProgress(current: string, next: string, hasMore: boolean): void {
  if (!/^\d+$/.test(next)) throw new Error("SYNC_INVALID_CURSOR");
  const currentValue = BigInt(current);
  const nextValue = BigInt(next);
  if (nextValue < currentValue) throw new Error("SYNC_CURSOR_REGRESSION");
  if (hasMore && nextValue === currentValue) throw new Error("SYNC_CURSOR_STALLED");
}

function assertPullScope(changes: SyncChangeRecord[], branchId: string, ownerId: string | undefined): void {
  for (const change of changes) {
    if (change.branchId !== branchId) throw new Error("SYNC_BRANCH_SCOPE_MISMATCH");
    if (ownerId !== undefined && change.ownerId !== ownerId) throw new Error("SYNC_OWNER_SCOPE_MISMATCH");
  }
}

async function applySaleDeltasToLocalCatalog(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const deltas: { productId: string; quantity: string }[] = [];
  for (const change of changes) {
    if (change.type !== "SALE") continue;
    const payload = change.payload as { lines?: { productId: string; quantity: string }[] };
    for (const line of payload.lines ?? []) {
      deltas.push({ productId: line.productId, quantity: line.quantity });
    }
  }
  if (deltas.length === 0) return;
  await adjustLocalStock(changes[0]!.branchId, deltas, database);
}

async function recordSyncError(
  branchId: string,
  ownerId: string | undefined,
  cursor: string,
  error: unknown,
  database: FiaoOfflineDatabase
): Promise<void> {
  if (!ownerId) return;
  const latest = await database.syncMeta.get(branchId);
  if (latest && latest.ownerId !== ownerId) throw new Error("OFFLINE_OWNER_SCOPE_MISMATCH");
  await database.syncMeta.put({
    branchId,
    ownerId,
    cursor: latest?.cursor ?? cursor,
    lastSyncAt: latest?.lastSyncAt ?? null,
    lastError: error instanceof Error ? error.message : "SYNC_ERROR"
  });
}
