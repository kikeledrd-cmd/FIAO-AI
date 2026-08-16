import type { Role } from "@fiao/contracts/auth";

/** Límite de gasto del cajero sin autorización del dueño (RD$ 1.000). */
export const CASHIER_EXPENSE_LIMIT_CENTS = 100_000;

export interface ExpectedCashInput {
  openingFloatCents: number;
  cashSalesCents: number;
  cashCollectionsCents: number;
  injectionsCents: number;
  expensesCents: number;
  withdrawalsCents: number;
}

/**
 * Efectivo físico esperado (spec §10.5):
 *
 *   opening float + cash sales + cash collections + cash injections
 *   − cash expenses − withdrawals − cash refunds
 *
 * Los reembolsos en efectivo entran como ventas cash negativas (las ventas
 * anuladas simplemente no cuentan), por lo que la fórmula queda:
 *
 *   opening + cashSales + cashCollections + injections − expenses − withdrawals
 *
 * Siempre aritmética entera en centavos; nunca números flotantes.
 */
export function computeExpectedCash(input: ExpectedCashInput): number {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value)) throw new Error(`INVALID_AMOUNT:${name}`);
  }
  const expected =
    input.openingFloatCents +
    input.cashSalesCents +
    input.cashCollectionsCents +
    input.injectionsCents -
    input.expensesCents -
    input.withdrawalsCents;
  if (expected < 0) throw new Error("NEGATIVE_EXPECTED_CASH");
  return expected;
}

/** Monto entero positivo en centavos (gastos/retiros/inyecciones). */
export function assertPositiveCents(value: number, errorCode = "INVALID_AMOUNT"): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(errorCode);
}

/** Monto entero no negativo en centavos (float inicial / efectivo contado). */
export function assertNonNegativeCents(value: number, errorCode = "INVALID_AMOUNT"): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(errorCode);
}

/**
 * Regla del gasto (spec §10.3): el cajero puede gastar hasta el límite; por
 * encima necesita autorización del dueño. El rol OWNER siempre pasa.
 */
export function assertExpenseAllowed(role: Role, amountCents: number, ownerAuthorized: boolean): void {
  assertPositiveCents(amountCents);
  if (role === "OWNER") return;
  if (amountCents > CASHIER_EXPENSE_LIMIT_CENTS && !ownerAuthorized) {
    throw new Error("OWNER_AUTHORIZATION_REQUIRED");
  }
}

/**
 * Retiros e inyecciones siempre requieren autorización del dueño para el
 * cajero (spec §10.4 y 10.2).
 */
export function assertOwnerProtectedMovement(role: Role, ownerAuthorized: boolean): void {
  if (role === "OWNER") return;
  if (!ownerAuthorized) throw new Error("OWNER_AUTHORIZATION_REQUIRED");
}

/**
 * Cierre (spec §10.5): el cajero puede cerrar cuadrando; cerrar con
 * diferencia requiere autorización del dueño. El rol OWNER siempre pasa.
 */
export function assertCanClose(role: Role, differenceCents: number, ownerAuthorized: boolean): void {
  if (role === "OWNER") return;
  if (differenceCents !== 0 && !ownerAuthorized) throw new Error("OWNER_AUTHORIZATION_REQUIRED");
}
