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

/** Réplica local del catálogo de una sucursal (para vender offline). */
export interface CatalogRow {
  productId: string;
  ownerId: string;
  branchId: string;
  name: string;
  barcode: string | null;
  priceCents: number;
  stockControl: boolean;
  unitLabel: string;
  onHand: string | null;
  active: boolean;
}

/** Cliente local con saldo derivado (para fiar y abonar offline). */
export interface LocalCustomerRow {
  customerId: string;
  ownerId: string;
  branchId: string;
  name: string;
  phoneE164: string | null;
  creditLimitCents: number;
  defaultPromiseDays: number;
  active: boolean;
  balanceCents: number;
}

/** Movimiento de crédito local (deltas CREDIT aplicados por el sync). */
export interface CreditMovementRow {
  movementId: string;
  ownerId: string;
  branchId: string;
  type: "FIAO_SALE" | "ABONO";
  customerId: string;
  amountCents: number;
  saleId: string | null;
  abonoId: string | null;
  occurredAt: string;
}

export class FiaoOfflineDatabase extends Dexie {
  pendingOperations!: Table<PendingOperationRow, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  syncConflicts!: Table<SyncConflictRow, string>;
  branches!: Table<LocalBranchRow, string>;
  users!: Table<LocalUserRow, string>;
  projectionRows!: Table<ProjectionRow, string>;
  catalog!: Table<CatalogRow, string>;
  customers!: Table<LocalCustomerRow, string>;
  creditMovements!: Table<CreditMovementRow, string>;

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
    this.version(2).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active"
    });
    this.version(3).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active",
      customers: "&customerId, ownerId, branchId, name, active",
      creditMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt"
    });
  }
}

export const offlineDb = new FiaoOfflineDatabase();
