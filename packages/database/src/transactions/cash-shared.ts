import type { CommandContext } from "@fiao/domain/context";
import { computeExpectedCash } from "@fiao/domain/cash/cash-policy";
import type { FiaoPrismaClient } from "../client";
import { isOwnerAuthorized } from "./process-stock-adjustment";

export interface CashSessionRow {
  id: string;
  status: string;
  openingFloatCents: number;
}

/**
 * Busca la sesión de caja del payload y la valida para una operación:
 * devuelve { session, errorCode: null } si está abierta, o
 * { session: null, errorCode } si no existe / ya cerró.
 */
export async function findOpenCashSession(
  db: FiaoPrismaClient,
  context: CommandContext,
  sessionId: string
): Promise<{ session: CashSessionRow; errorCode: null } | { session: null; errorCode: string }> {
  const session = await db.cashSession.findFirst({
    where: { sessionId, ownerId: context.ownerId, branchId: context.branchId },
    select: { id: true, status: true, openingFloatCents: true }
  });
  if (!session) return { session: null, errorCode: "CASH_SESSION_REQUIRED" };
  if (session.status !== "OPEN") return { session: null, errorCode: "CASH_SESSION_CLOSED" };
  return { session, errorCode: null };
}

export { isOwnerAuthorized };

export interface CashMovementRow {
  type: string;
  amountCents: number;
}

/**
 * Efectivo físico esperado de la sesión (spec §10.5), computado desde
 * fuentes inmutables — nunca guardado:
 *
 *   float inicial + Σ ventas cash no anuladas + Σ abonos (efectivo en V1)
 *   + Σ inyecciones − Σ gastos − Σ retiros
 *
 * Las ventas anuladas se detectan por el syncChange REVERSAL (append-only).
 */
export async function computeExpectedCashForSession(
  db: FiaoPrismaClient,
  context: CommandContext,
  session: CashSessionRow
): Promise<number> {
  const [sales, reversals, abonos, movements] = await Promise.all([
    db.sale.findMany({
      where: { ownerId: context.ownerId, branchId: context.branchId },
      select: { saleId: true, payments: true }
    }),
    db.syncChange.findMany({
      where: { ownerId: context.ownerId, branchId: context.branchId, type: "REVERSAL" },
      select: { payload: true }
    }),
    db.creditMovement.findMany({
      where: { ownerId: context.ownerId, branchId: context.branchId, type: "ABONO" },
      select: { amountCents: true }
    }),
    db.cashMovement.findMany({
      where: { sessionId: session.id },
      select: { type: true, amountCents: true }
    })
  ]);

  const reversedSaleIds = new Set<string>();
  for (const reversal of reversals) {
    const payload = reversal.payload as { saleId?: unknown };
    if (typeof payload.saleId === "string") reversedSaleIds.add(payload.saleId);
  }

  const cashSalesCents = sales
    .filter((sale) => !reversedSaleIds.has(sale.saleId))
    .reduce((sum, sale) => sum + cashCentsOf(sale.payments), 0);
  const cashCollectionsCents = abonos.reduce((sum, abono) => sum + abono.amountCents, 0);

  let injectionsCents = 0;
  let expensesCents = 0;
  let withdrawalsCents = 0;
  for (const movement of movements) {
    if (movement.type === "INJECTION") injectionsCents += movement.amountCents;
    else if (movement.type === "EXPENSE") expensesCents += movement.amountCents;
    else if (movement.type === "WITHDRAWAL") withdrawalsCents += movement.amountCents;
  }

  return computeExpectedCash({
    openingFloatCents: session.openingFloatCents,
    cashSalesCents,
    cashCollectionsCents,
    injectionsCents,
    expensesCents,
    withdrawalsCents
  });
}

function cashCentsOf(payments: unknown): number {
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, payment) => {
    if (typeof payment !== "object" || payment === null) return sum;
    const candidate = payment as { method?: unknown; amountCents?: unknown };
    if (candidate.method === "CASH" && typeof candidate.amountCents === "number") {
      return sum + candidate.amountCents;
    }
    return sum;
  }, 0);
}
