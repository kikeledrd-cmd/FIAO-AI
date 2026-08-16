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

export function reduceSaleChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "SALE") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const saleId = payload.saleId;
  if (typeof saleId !== "string" || saleId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:SALE:${saleId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reduceCustomerChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "CUSTOMER") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const customerId = payload.customerId;
  if (typeof customerId !== "string" || customerId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:CUSTOMER:${customerId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reduceCreditChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "CREDIT") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const movementId = payload.movementId;
  const customerId = payload.customerId;
  if (typeof movementId !== "string" || movementId.length === 0 || typeof customerId !== "string" || customerId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:CREDIT:${movementId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reduceChange(change: SyncChangeRecord): ProjectionRowValue {
  switch (change.type) {
    case "NOOP":
      return reduceFoundationChange(change);
    case "SALE":
      return reduceSaleChange(change);
    case "CUSTOMER":
      return reduceCustomerChange(change);
    case "CREDIT":
      return reduceCreditChange(change);
    default:
      throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return value as Record<string, unknown>;
}
