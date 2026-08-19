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
  costCents?: number;
  stockControl: boolean;
  unitLabel: string;
  onHand: string | null;
  reserved?: string;
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
  type: "FIAO_SALE" | "ABONO" | "APARTADO_REFUND";
  customerId: string;
  amountCents: number;
  saleId: string | null;
  abonoId: string | null;
  occurredAt: string;
}

/** Proveedor local (deltas SUPPLIER aplicados por el sync). */
export interface LocalSupplierRow {
  supplierId: string;
  ownerId: string;
  branchId: string;
  name: string;
  phoneE164: string | null;
  active: boolean;
}

/** Sesión de caja local (deltas CASH_OPEN/CASH_CLOSE aplicados por el sync). */
export interface LocalCashSessionRow {
  sessionId: string;
  ownerId: string;
  branchId: string;
  status: "OPEN" | "CLOSED";
  openingFloatCents: number;
  openedAt: string;
  countedCents: number | null;
  differenceCents: number | null;
  closedAt: string | null;
}

/** Movimiento de caja local (append-only; deltas CASH_* aplicados por el sync). */
export interface LocalCashMovementRow {
  movementId: string;
  ownerId: string;
  branchId: string;
  sessionId: string;
  type: "EXPENSE" | "WITHDRAWAL" | "INJECTION" | "DIFFERENCE";
  amountCents: number;
  category: string | null;
  description: string | null;
  reason: string | null;
  occurredAt: string;
}

/** Apartado local (deltas APARTADO aplicados por el sync). */
export interface LocalApartadoRow {
  apartadoId: string;
  ownerId: string;
  branchId: string;
  customerId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  lines: { productId: string; quantity: string; priceCents: number; lineTotalCents: number }[];
  depositCents: number;
  totalCents: number;
  promiseDate: string | null;
  notes: string | null;
  saleId: string | null;
  reason: string | null;
  occurredAt: string;
}

/** Movimiento de puntos local (append-only; deltas LOYALTY aplicados por el sync). */
export interface LocalLoyaltyMovementRow {
  movementId: string;
  ownerId: string;
  branchId: string;
  customerId: string;
  type: "EARN" | "REDEEM" | "EXPIRE" | "REVERSAL";
  pointsDelta: number;
  saleId: string | null;
  rewardId: string | null;
  expiresAt: string | null;
  occurredAt: string;
}

/** Recompensa local (datos maestros del owner). */
export interface LocalLoyaltyRewardRow {
  rewardId: string;
  ownerId: string;
  name: string;
  kind: "FREE_PRODUCT" | "FIXED_DISCOUNT";
  productId: string | null;
  discountCents: number | null;
  pointsCost: number;
  active: boolean;
}

/** Config de lealtad local (datos maestros del owner). */
export interface LocalLoyaltyConfigRow {
  ownerId: string;
  enabled: boolean;
  pointsPerHundredCents: number;
  expiryDays: number;
}

/** Promoción local (datos maestros del owner). */
export interface LocalPromotionRow {
  id: string;
  ownerId: string;
  name: string;
  kind: "PERCENT_OFF" | "FIXED_OFF" | "BUNDLE_BUY_X_GET_Y";
  scope: "PRODUCT" | "TOTAL";
  productId: string | null;
  percentOffCents: number | null;
  fixedOffCents: number | null;
  buyQty: number | null;
  getQty: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

/** Pedido local (deltas ORDER aplicados por el sync). */
export interface LocalOrderRow {
  orderId: string;
  ownerId: string;
  branchId: string;
  source: "WHATSAPP" | "MANUAL" | "REPEAT";
  status: "NEW" | "PREPARING" | "READY" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED";
  customerId: string | null;
  lines: { productId: string; quantity: string; priceCents: number; lineTotalCents: number }[];
  deliveryName: string | null;
  deliveryAddress: string | null;
  deliveryFeeCents: number;
  totalCents: number;
  notes: string | null;
  exceptionReason: string | null;
  saleId: string | null;
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
  suppliers!: Table<LocalSupplierRow, string>;
  cashSessions!: Table<LocalCashSessionRow, string>;
  cashMovements!: Table<LocalCashMovementRow, string>;
  apartados!: Table<LocalApartadoRow, string>;
  loyaltyMovements!: Table<LocalLoyaltyMovementRow, string>;
  loyaltyRewards!: Table<LocalLoyaltyRewardRow, string>;
  loyaltyConfig!: Table<LocalLoyaltyConfigRow, string>;
  promotions!: Table<LocalPromotionRow, string>;
  orders!: Table<LocalOrderRow, string>;

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
    this.version(4).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active",
      customers: "&customerId, ownerId, branchId, name, active",
      creditMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      suppliers: "&supplierId, ownerId, branchId, name, active"
    });
    this.version(5).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active",
      customers: "&customerId, ownerId, branchId, name, active",
      creditMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      suppliers: "&supplierId, ownerId, branchId, name, active",
      cashSessions: "&sessionId, ownerId, branchId, status",
      cashMovements: "&movementId, ownerId, branchId, sessionId, type, occurredAt"
    });
    this.version(6).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active",
      customers: "&customerId, ownerId, branchId, name, active",
      creditMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      suppliers: "&supplierId, ownerId, branchId, name, active",
      cashSessions: "&sessionId, ownerId, branchId, status",
      cashMovements: "&movementId, ownerId, branchId, sessionId, type, occurredAt",
      apartados: "&apartadoId, ownerId, branchId, customerId, status, occurredAt",
      loyaltyMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      loyaltyRewards: "&rewardId, ownerId, active",
      loyaltyConfig: "&ownerId",
      promotions: "&id, ownerId, active"
    });
    this.version(7).stores({
      pendingOperations: "&operationId, branchId, occurredAt, queuedAt",
      syncMeta: "&branchId, ownerId",
      syncConflicts: "&id, ownerId, operationId, branchId, kind, createdAt",
      branches: "&id, ownerId",
      users: "&id, ownerId, role",
      projectionRows: "&key, ownerId, branchId, type, cursor",
      catalog: "&productId, ownerId, branchId, name, active",
      customers: "&customerId, ownerId, branchId, name, active",
      creditMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      suppliers: "&supplierId, ownerId, branchId, name, active",
      cashSessions: "&sessionId, ownerId, branchId, status",
      cashMovements: "&movementId, ownerId, branchId, sessionId, type, occurredAt",
      apartados: "&apartadoId, ownerId, branchId, customerId, status, occurredAt",
      loyaltyMovements: "&movementId, ownerId, branchId, customerId, type, occurredAt",
      loyaltyRewards: "&rewardId, ownerId, active",
      loyaltyConfig: "&ownerId",
      promotions: "&id, ownerId, active",
      orders: "&orderId, ownerId, branchId, status, occurredAt"
    });
  }
}

export const offlineDb = new FiaoOfflineDatabase();
