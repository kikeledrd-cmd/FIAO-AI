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

export function reduceStockAdjustmentChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "STOCK_ADJUSTMENT") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const adjustmentId = payload.adjustmentId;
  const productId = payload.productId;
  if (typeof adjustmentId !== "string" || adjustmentId.length === 0 || typeof productId !== "string" || productId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:STOCK_ADJUSTMENT:${adjustmentId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reduceReversalChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "REVERSAL") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const reversalId = payload.reversalId;
  const saleId = payload.saleId;
  if (typeof reversalId !== "string" || reversalId.length === 0 || typeof saleId !== "string" || saleId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:REVERSAL:${reversalId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reduceSupplierChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "SUPPLIER") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const supplierId = payload.supplierId;
  if (typeof supplierId !== "string" || supplierId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:SUPPLIER:${supplierId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

export function reducePurchaseChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "PURCHASE") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const purchaseId = payload.purchaseId;
  if (typeof purchaseId !== "string" || purchaseId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:PURCHASE:${purchaseId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

/** Sesión de caja (CASH_OPEN/CASH_CLOSE → upsert del estado de la sesión). */
export function reduceCashSessionChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "CASH_OPEN" && change.type !== "CASH_CLOSE") {
    throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  }
  const payload = asRecord(change.payload);
  const sessionId = payload.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:CASH_SESSION:${sessionId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

/** Movimiento de caja (CASH_EXPENSE/WITHDRAWAL/INJECTION → append-only). */
export function reduceCashMovementChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "CASH_EXPENSE" && change.type !== "CASH_WITHDRAWAL" && change.type !== "CASH_INJECTION") {
    throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  }
  const payload = asRecord(change.payload);
  const movementId = payload.movementId;
  if (typeof movementId !== "string" || movementId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:CASH_MOVEMENT:${movementId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

/** Apartado (APARTADO_CREATE/COMPLETE/CANCEL → upsert del estado). */
export function reduceApartadoChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "APARTADO") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const apartadoId = payload.apartadoId;
  if (typeof apartadoId !== "string" || apartadoId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:APARTADO:${apartadoId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

/** Movimiento del ledger de puntos (LOYALTY → append-only). */
export function reduceLoyaltyChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "LOYALTY") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const movementId = payload.movementId;
  const customerId = payload.customerId;
  if (typeof movementId !== "string" || movementId.length === 0 || typeof customerId !== "string" || customerId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:LOYALTY:${movementId}`,
    ownerId: change.ownerId,
    branchId: change.branchId,
    type: change.type,
    cursor: change.cursor,
    payload: change.payload
  };
}

/** Pedido (ORDER_CREATE/ACCEPT/ADVANCE/CANCEL/DELIVER → upsert del estado). */
export function reduceOrderChange(change: SyncChangeRecord): ProjectionRowValue {
  if (change.type !== "ORDER") throw new Error("UNKNOWN_SYNC_CHANGE_TYPE");
  const payload = asRecord(change.payload);
  const orderId = payload.orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("INVALID_SYNC_CHANGE_PAYLOAD");
  }
  return {
    key: `${change.ownerId}:${change.branchId}:ORDER:${orderId}`,
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
    case "STOCK_ADJUSTMENT":
      return reduceStockAdjustmentChange(change);
    case "REVERSAL":
      return reduceReversalChange(change);
    case "SUPPLIER":
      return reduceSupplierChange(change);
    case "PURCHASE":
      return reducePurchaseChange(change);
    case "CASH_OPEN":
    case "CASH_CLOSE":
      return reduceCashSessionChange(change);
    case "CASH_EXPENSE":
    case "CASH_WITHDRAWAL":
    case "CASH_INJECTION":
      return reduceCashMovementChange(change);
    case "APARTADO":
      return reduceApartadoChange(change);
    case "LOYALTY":
      return reduceLoyaltyChange(change);
    case "ORDER":
      return reduceOrderChange(change);
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
