import type { CashMovement, CashSession } from "@fiao/contracts/cash";
import { apiJson } from "@/lib/api/client";
import { offlineDb, type FiaoOfflineDatabase, type LocalCashMovementRow, type LocalCashSessionRow } from "./db";

/** Estado de caja servido por GET /api/cash. */
export interface CashState {
  session: CashSession | null;
  movements: CashMovement[];
  expectedCents: number | null;
}

export async function loadCashStateFromServer(branchId: string): Promise<CashState> {
  return apiJson<CashState>(`/api/cash?branchId=${encodeURIComponent(branchId)}`);
}

/** Persiste el estado del servidor en la réplica local (Dexie). */
export async function saveCashStateLocally(state: CashState, database: FiaoOfflineDatabase = offlineDb): Promise<void> {
  await database.transaction("rw", database.cashSessions, database.cashMovements, async () => {
    if (state.session) {
      await database.cashSessions.put({
        sessionId: state.session.sessionId,
        ownerId: state.session.ownerId,
        branchId: state.session.branchId,
        status: state.session.status,
        openingFloatCents: state.session.openingFloatCents,
        openedAt: state.session.openedAt,
        countedCents: state.session.countedCents,
        differenceCents: state.session.differenceCents,
        closedAt: state.session.closedAt
      });
    }
    for (const movement of state.movements) {
      await database.cashMovements.put({
        movementId: movement.movementId,
        ownerId: movement.ownerId,
        branchId: movement.branchId,
        sessionId: movement.sessionId,
        type: movement.type,
        amountCents: movement.amountCents,
        category: movement.category,
        description: movement.description,
        reason: movement.reason,
        occurredAt: movement.occurredAt
      });
    }
  });
}

export async function listCashSessionsLocally(
  branchId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<LocalCashSessionRow[]> {
  return database.cashSessions.where("branchId").equals(branchId).toArray();
}

export async function listCashMovementsLocally(
  sessionId: string,
  database: FiaoOfflineDatabase = offlineDb
): Promise<LocalCashMovementRow[]> {
  return database.cashMovements.where("sessionId").equals(sessionId).sortBy("occurredAt");
}

/**
 * Esperado local (misma fórmula que el servidor, spec §10.5) con los datos
 * de la réplica: float + Σ abonos − Σ gastos − Σ retiros + Σ inyecciones.
 * Las ventas cash offline no están en la réplica (solo en el servidor), por
 * lo que el esperado local es parcial cuando hay ventas sin sincronizar;
 * el servidor recalcula el esperado exacto al cerrar.
 */
export function computeLocalExpectedCash(
  session: Pick<LocalCashSessionRow, "openingFloatCents">,
  movements: Pick<LocalCashMovementRow, "type" | "amountCents">[],
  abonosCents: number
): number {
  let total = session.openingFloatCents + abonosCents;
  for (const movement of movements) {
    if (movement.type === "EXPENSE" || movement.type === "WITHDRAWAL") total -= movement.amountCents;
    if (movement.type === "INJECTION") total += movement.amountCents;
  }
  return total;
}
