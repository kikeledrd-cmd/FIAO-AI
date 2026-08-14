import type { ClientOperationEnvelope, OperationResult, SyncChangeRecord } from "@fiao/contracts/sync";
import { reduceFoundationChange } from "@fiao/sync/local-reducer";
import { FiaoOfflineDatabase, offlineDb, type PendingOperationRow, type SyncConflictRow } from "./db";

export interface EnqueueOperationInput<TPayload = unknown> {
  type: string;
  payload: TPayload;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  occurredAt?: string;
}

export async function enqueueOperation<TPayload>(
  input: EnqueueOperationInput<TPayload>,
  database: FiaoOfflineDatabase = offlineDb
): Promise<ClientOperationEnvelope<string, TPayload>> {
  const meta = await database.syncMeta.get(input.branchId);
  if (meta && meta.ownerId !== input.ownerId) throw new Error("OFFLINE_OWNER_SCOPE_MISMATCH");
  const envelope: ClientOperationEnvelope<string, TPayload> = {
    operationId: crypto.randomUUID(),
    type: input.type,
    ownerId: input.ownerId,
    branchId: input.branchId,
    actorUserId: input.actorUserId,
    deviceId: input.deviceId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    baseCursor: meta?.cursor ?? null,
    payload: input.payload
  };

  await database.pendingOperations.add({
    ...envelope,
    queuedAt: new Date().toISOString()
  });
  return envelope;
}

export async function markOperationResult(
  result: OperationResult,
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  const pending = await database.pendingOperations.get(result.operationId);
  if (!pending) return;

  await database.transaction("rw", database.pendingOperations, database.syncConflicts, async () => {
    await database.pendingOperations.delete(result.operationId);
    if (result.status === "ACCEPTED") return;

    const row: SyncConflictRow = {
      id: result.conflictId ?? `${result.status}:${result.operationId}`,
      ownerId: pending.ownerId,
      operationId: result.operationId,
      branchId: pending.branchId,
      kind: result.status === "ACCEPTED_WITH_CONFLICT" ? "CONFLICT" : "REJECTED",
      envelope: pending,
      result,
      createdAt: new Date().toISOString()
    };
    await database.syncConflicts.put(row);
  });
}

export async function applySyncChanges(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase = offlineDb
): Promise<void> {
  if (changes.length === 0) return;

  await database.transaction("rw", database.projectionRows, database.syncMeta, async () => {
    const latestByBranch = new Map<string, { ownerId: string; cursor: string }>();
    for (const change of changes) {
      const row = reduceFoundationChange(change);
      await database.projectionRows.put(row);
      const previous = latestByBranch.get(change.branchId);
      if (previous && previous.ownerId !== change.ownerId) throw new Error("OFFLINE_OWNER_SCOPE_MISMATCH");
      if (previous === undefined || BigInt(change.cursor) > BigInt(previous.cursor)) {
        latestByBranch.set(change.branchId, { ownerId: change.ownerId, cursor: change.cursor });
      }
    }

    const syncedAt = new Date().toISOString();
    for (const [branchId, meta] of latestByBranch) {
      await database.syncMeta.put({
        branchId,
        ownerId: meta.ownerId,
        cursor: meta.cursor,
        lastSyncAt: syncedAt,
        lastError: null
      });
    }
  });
}

export async function listPendingOperations(
  branchId: string,
  limit = 100,
  database: FiaoOfflineDatabase = offlineDb
): Promise<PendingOperationRow[]> {
  const rows = await database.pendingOperations.where("branchId").equals(branchId).sortBy("queuedAt");
  return rows.slice(0, limit);
}
