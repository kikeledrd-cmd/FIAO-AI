import Dexie, { type Table } from "dexie";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";

export interface PendingOperationRow extends ClientOperationEnvelope {
  queuedAt: string;
}

export interface SyncMetaRow {
  branchId: string;
  ownerId: string;
  cursor: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncConflictRow {
  id: string;
  ownerId: string;
  operationId: string;
  branchId: string;
  kind: "CONFLICT" | "REJECTED";
  envelope: PendingOperationRow;
  result: OperationResult;
  createdAt: string;
}

export interface LocalBranchRow {
  id: string;
  ownerId: string;
  name: string;
  timezone: string;
}

export interface LocalUserRow {
  id: string;
  ownerId: string;
  name: string;
  role: "OWNER" | "CASHIER";
}

export interface ProjectionRow {
  key: string;
  ownerId: string;
  branchId: string;
  type: string;
  cursor: string;
  payload: unknown;
}

export class FiaoOfflineDatabase extends Dexie {
  pendingOperations!: Table<PendingOperationRow, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  syncConflicts!: Table<SyncConflictRow, string>;
  branches!: Table<LocalBranchRow, string>;
  users!: Table<LocalUserRow, string>;
  projectionRows!: Table<ProjectionRow, string>;

  constructor(name = "fiao-offline") {
    super(name);
    this.version(1).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor"
    });
  }
}

export const offlineDb = new FiaoOfflineDatabase();
