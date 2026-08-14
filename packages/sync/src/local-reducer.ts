import type { SyncChangeRecord } from "@fiao/contracts/sync";

export interface ProjectionRowValue {
  key: string;
  ownerId: string;
  branchId: string;
  type: string;
  cursor: string;
  payload: unknown;
}

export function reduceFoundationChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "NOOP") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const operationId = payload.operationId;
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }

  return {
    key: `${change.ownerId}:${change.branchId}:NOOP:${operationId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return value as Record<string, unknown>;
}
