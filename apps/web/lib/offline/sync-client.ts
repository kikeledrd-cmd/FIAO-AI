import type { ClientOperationEnvelope, OperationResult, SyncChangeRecord } from "@fiao/contracts/sync";
import { ApiError, apiJson } from "@/lib/api/client";
import { FiaoOfflineDatabase, offlineDb, type LocalApartadoRow, type LocalOrderRow } from "./db";
import { applySyncChanges, listPendingOperations, markOperationResult } from "./queue";
import { applySignedStockDeltas, adjustLocalStock } from "./catalog";
import { applyCreditDeltasLocally, upsertCustomersLocally } from "./customers";
import { upsertSuppliersLocally } from "./suppliers";

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
          await applyReversalDeltasToLocalCatalog(response.changes, database);
          await applyPurchaseDeltasToLocalCatalog(response.changes, database);
          await applyCustomerDeltasLocally(response.changes, database);
          await applyCreditDeltasLocally(response.changes, database);
          await upsertSuppliersLocally(response.changes, database);
          await applyCashDeltasLocally(response.changes, database);
          await applyApartadoDeltasLocally(response.changes, database);
          await applyLoyaltyDeltasLocally(response.changes, database);
          await applyOrderDeltasLocally(response.changes, database);
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

async function applyReversalDeltasToLocalCatalog(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const deltas: { productId: string; quantityDelta: string }[] = [];
  for (const change of changes) {
    if (change.type === "REVERSAL") {
      const payload = change.payload as { lines?: { productId: string; quantity: string }[] };
      for (const line of payload.lines ?? []) {
        deltas.push({ productId: line.productId, quantityDelta: `+${line.quantity}` });
      }
    }
    if (change.type === "STOCK_ADJUSTMENT") {
      const payload = change.payload as { productId?: string; quantityDelta?: string };
      if (payload.productId && payload.quantityDelta) {
        deltas.push({ productId: payload.productId, quantityDelta: payload.quantityDelta });
      }
    }
  }
  if (deltas.length === 0) return;
  await applySignedStockDeltas(changes[0]!.branchId, deltas, database);
}

async function applyPurchaseDeltasToLocalCatalog(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const deltas: { productId: string; quantityDelta: string }[] = [];
  const costEntries: { productId: string; costCents: number }[] = [];
  for (const change of changes) {
    if (change.type !== "PURCHASE") continue;
    const payload = change.payload as { lines?: { productId: string; quantity: string }[]; costAfter?: { productId: string; costCents: number }[] };
    for (const line of payload.lines ?? []) {
      deltas.push({ productId: line.productId, quantityDelta: `+${line.quantity}` });
    }
    const costAfter = payload.costAfter;
    if (costAfter) costEntries.push(...costAfter);
  }
  if (deltas.length === 0) return;
  await database.transaction("rw", database.catalog, async () => {
    for (const delta of deltas) {
      const row = await database.catalog.get(delta.productId);
      if (!row || !row.stockControl) continue;
      row.onHand = addToQuantity(row.onHand ?? "0", delta.quantityDelta.slice(1));
      const cost = costEntries.find((entry) => entry.productId === delta.productId);
      if (cost) row.costCents = cost.costCents;
      await database.catalog.put(row);
    }
  });
}

function addToQuantity(left: string, right: string): string {
  if (/^0+(\.0+)?$/.test(left)) return right;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const wholeA = leftParts[0] ?? "0";
  const fracA = leftParts[1] ?? "";
  const wholeB = rightParts[0] ?? "0";
  const fracB = rightParts[1] ?? "";
  const scaledA = BigInt(wholeA) * 1000n + BigInt((fracA + "000").slice(0, 3));
  const scaledB = BigInt(wholeB) * 1000n + BigInt((fracB + "000").slice(0, 3));
  const total = scaledA + scaledB;
  const whole = total / 1000n;
  const fraction = (total % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Aplica deltas de caja: CASH_OPEN/CASH_CLOSE actualizan la sesión y
 *  CASH_EXPENSE/WITHDRAWAL/INJECTION insertan movimientos append-only. */
async function applyCashDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  await database.transaction("rw", database.cashSessions, database.cashMovements, async () => {
    for (const change of changes) {
      if (change.type === "CASH_OPEN") {
        const payload = change.payload as {
          sessionId?: string;
          branchId?: string;
          openingFloatCents?: number;
          openedAt?: string;
        };
        if (!payload.sessionId || payload.openingFloatCents === undefined) continue;
        await database.cashSessions.put({
          sessionId: payload.sessionId,
          ownerId: change.ownerId,
          branchId: change.branchId,
          status: "OPEN",
          openingFloatCents: payload.openingFloatCents,
          openedAt: payload.openedAt ?? change.createdAt,
          countedCents: null,
          differenceCents: null,
          closedAt: null
        });
      } else if (change.type === "CASH_CLOSE") {
        const payload = change.payload as {
          sessionId?: string;
          countedCents?: number;
          differenceCents?: number;
          closedAt?: string;
        };
        if (!payload.sessionId || payload.countedCents === undefined) continue;
        const session = await database.cashSessions.get(payload.sessionId);
        if (!session) continue;
        await database.cashSessions.put({
          ...session,
          status: "CLOSED",
          countedCents: payload.countedCents,
          differenceCents: payload.differenceCents ?? 0,
          closedAt: payload.closedAt ?? change.createdAt
        });
      } else if (change.type === "CASH_EXPENSE" || change.type === "CASH_WITHDRAWAL" || change.type === "CASH_INJECTION") {
        const payload = change.payload as {
          movementId?: string;
          sessionId?: string;
          type?: string;
          amountCents?: number;
          category?: string | null;
          description?: string | null;
          reason?: string | null;
          occurredAt?: string;
        };
        if (!payload.movementId || !payload.sessionId || payload.amountCents === undefined) continue;
        const type = payload.type === "WITHDRAWAL" || payload.type === "INJECTION" || payload.type === "DIFFERENCE"
          ? payload.type
          : "EXPENSE";
        await database.cashMovements.put({
          movementId: payload.movementId,
          ownerId: change.ownerId,
          branchId: change.branchId,
          sessionId: payload.sessionId,
          type,
          amountCents: payload.amountCents,
          category: payload.category ?? null,
          description: payload.description ?? null,
          reason: payload.reason ?? null,
          occurredAt: payload.occurredAt ?? change.createdAt
        });
      }
    }
  });
}

/** Aplica deltas APARTADO: upsert del apartado y ajuste de reservas en el
 *  catálogo local (ACTIVE → reserved += qty; COMPLETED/CANCELLED → reserved
 *  −= qty). El onHand lo ajusta el delta SALE de la venta de completación. */
async function applyApartadoDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const apartadoChanges = changes.filter((change) => change.type === "APARTADO");
  if (apartadoChanges.length === 0) return;
  const reservationDeltas: { productId: string; quantityDelta: string }[] = [];
  await database.transaction("rw", database.apartados, database.catalog, async () => {
    for (const change of apartadoChanges) {
      const payload = change.payload as {
        apartadoId?: string;
        customerId?: string | null;
        status?: string;
        lines?: { productId: string; quantity: string; priceCents?: number; lineTotalCents?: number }[];
        depositCents?: number;
        totalCents?: number;
        promiseDate?: string | null;
        notes?: string | null;
        saleId?: string | null;
        reason?: string | null;
        occurredAt?: string;
      };
      if (!payload.apartadoId || !payload.status) continue;
      const existing = await database.apartados.get(payload.apartadoId);
      const lines = (payload.lines ?? existing?.lines ?? []).map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        priceCents: typeof line.priceCents === "number" ? line.priceCents : 0,
        lineTotalCents: typeof line.lineTotalCents === "number" ? line.lineTotalCents : 0
      }));
      await database.apartados.put({
        apartadoId: payload.apartadoId,
        ownerId: change.ownerId,
        branchId: change.branchId,
        customerId: payload.customerId ?? existing?.customerId ?? "",
        status: payload.status as LocalApartadoRow["status"],
        lines,
        depositCents: payload.depositCents ?? existing?.depositCents ?? 0,
        totalCents: payload.totalCents ?? existing?.totalCents ?? 0,
        promiseDate: payload.promiseDate ?? existing?.promiseDate ?? null,
        notes: payload.notes ?? existing?.notes ?? null,
        saleId: payload.saleId ?? existing?.saleId ?? null,
        reason: payload.reason ?? existing?.reason ?? null,
        occurredAt: payload.occurredAt ?? change.createdAt
      });
      for (const line of lines) {
        const sign = payload.status === "ACTIVE" ? "+" : "-";
        reservationDeltas.push({ productId: line.productId, quantityDelta: `${sign}${line.quantity}` });
      }
    }
    if (reservationDeltas.length === 0) return;
    for (const delta of reservationDeltas) {
      const row = await database.catalog.get(delta.productId);
      if (!row || !row.stockControl) continue;
      const reserved = row.reserved ?? "0";
      row.reserved = delta.quantityDelta.startsWith("-")
        ? subtractQuantitySafely(reserved, delta.quantityDelta.slice(1))
        : addToQuantity(reserved, delta.quantityDelta.slice(1));
      await database.catalog.put(row);
    }
  });
}

/** Aplica deltas LOYALTY: movimientos del ledger de puntos (append-only). */
async function applyLoyaltyDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const loyaltyChanges = changes.filter((change) => change.type === "LOYALTY");
  if (loyaltyChanges.length === 0) return;
  await database.transaction("rw", database.loyaltyMovements, async () => {
    for (const change of loyaltyChanges) {
      const payload = change.payload as {
        movementId?: string;
        customerId?: string;
        type?: string;
        pointsDelta?: number;
        saleId?: string | null;
        rewardId?: string | null;
        expiresAt?: string | null;
        occurredAt?: string;
      };
      if (!payload.movementId || !payload.customerId || payload.pointsDelta === undefined) continue;
      const type = payload.type === "REDEEM" || payload.type === "EXPIRE" || payload.type === "REVERSAL"
        ? payload.type
        : "EARN";
      await database.loyaltyMovements.put({
        movementId: payload.movementId,
        ownerId: change.ownerId,
        branchId: change.branchId,
        customerId: payload.customerId,
        type,
        pointsDelta: payload.pointsDelta,
        saleId: payload.saleId ?? null,
        rewardId: payload.rewardId ?? null,
        expiresAt: payload.expiresAt ?? null,
        occurredAt: payload.occurredAt ?? change.createdAt
      });
    }
  });
}

/** Aplica deltas ORDER: upsert del pedido y ajuste de reservas del catA�logo
 *  local (NEW �+' PREPARING reserva += qty; CANCELLED/DELIVERED libera += qty). */
async function applyOrderDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const orderChanges = changes.filter((change) => change.type === "ORDER");
  if (orderChanges.length === 0) return;
  const reservationDeltas: { productId: string; quantityDelta: string }[] = [];
  await database.transaction("rw", database.orders, database.catalog, async () => {
    for (const change of orderChanges) {
      const payload = change.payload as {
        orderId?: string;
        status?: string;
        source?: string;
        customerId?: string | null;
        lines?: { productId: string; quantity: string; priceCents?: number; lineTotalCents?: number }[];
        totalCents?: number;
        deliveryName?: string | null;
        deliveryAddress?: string | null;
        deliveryFeeCents?: number;
        notes?: string | null;
        exceptionReason?: string | null;
        saleId?: string | null;
        occurredAt?: string;
      };
      if (!payload.orderId || !payload.status) continue;
      const existing = await database.orders.get(payload.orderId);
      const lines = (payload.lines ?? existing?.lines ?? []).map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        priceCents: typeof line.priceCents === "number" ? line.priceCents : 0,
        lineTotalCents: typeof line.lineTotalCents === "number" ? line.lineTotalCents : 0
      }));
      await database.orders.put({
        orderId: payload.orderId,
        ownerId: change.ownerId,
        branchId: change.branchId,
        source: (payload.source as LocalOrderRow["source"]) ?? existing?.source ?? "MANUAL",
        status: payload.status as LocalOrderRow["status"],
        customerId: payload.customerId ?? existing?.customerId ?? null,
        lines,
        deliveryName: payload.deliveryName ?? existing?.deliveryName ?? null,
        deliveryAddress: payload.deliveryAddress ?? existing?.deliveryAddress ?? null,
        deliveryFeeCents: payload.deliveryFeeCents ?? existing?.deliveryFeeCents ?? 0,
        totalCents: payload.totalCents ?? existing?.totalCents ?? 0,
        notes: payload.notes ?? existing?.notes ?? null,
        exceptionReason: payload.exceptionReason ?? existing?.exceptionReason ?? null,
        saleId: payload.saleId ?? existing?.saleId ?? null,
        occurredAt: payload.occurredAt ?? change.createdAt
      });

      // Ajuste de reservas solo en transiciones que cambian la reserva.
      const oldStatus = existing?.status;
      const newStatus = payload.status;
      const reserves = newStatus === "PREPARING" || newStatus === "READY" || newStatus === "ON_THE_WAY";
      const releases = newStatus === "CANCELLED" || newStatus === "DELIVERED";
      if (reserves && oldStatus === "NEW") {
        for (const line of lines) reservationDeltas.push({ productId: line.productId, quantityDelta: `+${line.quantity}` });
      } else if (releases && oldStatus && oldStatus !== "NEW" && oldStatus !== "CANCELLED" && oldStatus !== "DELIVERED") {
        for (const line of lines) reservationDeltas.push({ productId: line.productId, quantityDelta: `-${line.quantity}` });
      }
    }
    if (reservationDeltas.length === 0) return;
    for (const delta of reservationDeltas) {
      const row = await database.catalog.get(delta.productId);
      if (!row || !row.stockControl) continue;
      const reserved = row.reserved ?? "0";
      row.reserved = delta.quantityDelta.startsWith("-")
        ? subtractQuantitySafely(reserved, delta.quantityDelta.slice(1))
        : addToQuantity(reserved, delta.quantityDelta.slice(1));
      await database.catalog.put(row);
    }
  });
}

function subtractQuantitySafely(left: string, right: string): string {
  if (/^0+(\.[0-9]+)?$/.test(left)) return "0";
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const wholeA = leftParts[0] ?? "0";
  const fracA = leftParts[1] ?? "";
  const wholeB = rightParts[0] ?? "0";
  const fracB = rightParts[1] ?? "";
  const scaledA = BigInt(wholeA) * 1000n + BigInt((fracA + "000").slice(0, 3));
  const scaledB = BigInt(wholeB) * 1000n + BigInt((fracB + "000").slice(0, 3));
  const total = scaledA - scaledB;
  if (total < 0n) return "0";
  const whole = total / 1000n;
  const fraction = (total % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

async function applyCustomerDeltasLocally(
  changes: SyncChangeRecord[],
  database: FiaoOfflineDatabase
): Promise<void> {
  const customers = changes
    .filter((change) => change.type === "CUSTOMER")
    .map((change) => change.payload as CustomerDeltaPayload);
  if (customers.length === 0) return;
  await upsertCustomersLocally(customers, database);
}

interface CustomerDeltaPayload {
  customerId: string;
  name: string;
  phoneE164: string | null;
  creditLimitCents: number;
  defaultPromiseDays: number;
  active: boolean;
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
