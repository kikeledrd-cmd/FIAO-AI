export type OperationStatus = "ACCEPTED" | "ACCEPTED_WITH_CONFLICT" | "REJECTED";

export interface ClientOperationEnvelope<TType extends string = string, TPayload = unknown> {
  operationId: string;
  type: TType;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  deviceId: string;
  occurredAt: string;
  baseCursor: string | null;
  payload: TPayload;
}

export interface OperationResult {
  operationId: string;
  status: OperationStatus;
  conflictId?: string;
  errorCode?: string;
  latestCursor: string;
}

export interface SyncChangeRecord<TPayload = unknown> {
  cursor: string;
  ownerId: string;
  branchId: string;
  type: string;
  payload: TPayload;
  createdAt: string;
}
