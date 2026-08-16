import { describe, expect, it } from "vitest";
import {
  assertCanClose,
  assertExpenseAllowed,
  assertNonNegativeCents,
  assertOwnerProtectedMovement,
  assertPositiveCents,
  CASHIER_EXPENSE_LIMIT_CENTS,
  computeExpectedCash
} from "./cash-policy";

describe("computeExpectedCash", () => {
  const base = {
    openingFloatCents: 2000_00,
    cashSalesCents: 0,
    cashCollectionsCents: 0,
    injectionsCents: 0,
    expensesCents: 0,
    withdrawalsCents: 0
  };

  it("devuelve el float inicial sin movimientos", () => {
    expect(computeExpectedCash(base)).toBe(2000_00);
  });

  it("suma ventas y cobros en efectivo", () => {
    expect(
      computeExpectedCash({ ...base, cashSalesCents: 1540_50, cashCollectionsCents: 350_00 })
    ).toBe(2000_00 + 1540_50 + 350_00);
  });

  it("suma inyecciones y resta gastos y retiros", () => {
    expect(
      computeExpectedCash({
        ...base,
        injectionsCents: 500_00,
        expensesCents: 120_75,
        withdrawalsCents: 300_00
      })
    ).toBe(2000_00 + 500_00 - 120_75 - 300_00);
  });

  it("el efectivo esperado nunca es negativo", () => {
    expect(() => computeExpectedCash({ ...base, withdrawalsCents: 9999_99 })).toThrow(
      "NEGATIVE_EXPECTED_CASH"
    );
  });

  it("rechaza montos flotantes", () => {
    expect(() => computeExpectedCash({ ...base, cashSalesCents: 1.5 })).toThrow(
      "INVALID_AMOUNT:cashSalesCents"
    );
  });
});

describe("assertPositiveCents / assertNonNegativeCents", () => {
  it("acepta enteros positivos y rechaza cero/negativos/flotantes", () => {
    expect(() => assertPositiveCents(1)).not.toThrow();
    expect(() => assertPositiveCents(0)).toThrow("INVALID_AMOUNT");
    expect(() => assertPositiveCents(-5)).toThrow("INVALID_AMOUNT");
    expect(() => assertPositiveCents(1.5)).toThrow("INVALID_AMOUNT");
  });

  it("acepta cero para float inicial y efectivo contado", () => {
    expect(() => assertNonNegativeCents(0)).not.toThrow();
    expect(() => assertNonNegativeCents(-1)).toThrow("INVALID_AMOUNT");
  });
});

describe("assertExpenseAllowed", () => {
  it("el OWNER gasta cualquier monto sin autorización", () => {
    expect(() => assertExpenseAllowed("OWNER", 9999_99, false)).not.toThrow();
  });

  it("el cajero gasta hasta el límite sin autorización", () => {
    expect(() => assertExpenseAllowed("CASHIER", CASHIER_EXPENSE_LIMIT_CENTS, false)).not.toThrow();
  });

  it("el cajero no puede superar el límite sin autorización", () => {
    expect(() => assertExpenseAllowed("CASHIER", CASHIER_EXPENSE_LIMIT_CENTS + 1, false)).toThrow(
      "OWNER_AUTHORIZATION_REQUIRED"
    );
  });

  it("el cajero con autorización supera el límite", () => {
    expect(() => assertExpenseAllowed("CASHIER", CASHIER_EXPENSE_LIMIT_CENTS + 1, true)).not.toThrow();
  });
});

describe("assertOwnerProtectedMovement", () => {
  it("OWNER pasa directo", () => {
    expect(() => assertOwnerProtectedMovement("OWNER", false)).not.toThrow();
  });

  it("cajero sin autorización es rechazado", () => {
    expect(() => assertOwnerProtectedMovement("CASHIER", false)).toThrow("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("cajero con autorización pasa", () => {
    expect(() => assertOwnerProtectedMovement("CASHIER", true)).not.toThrow();
  });
});

describe("assertCanClose", () => {
  it("OWNER cierra con o sin diferencia", () => {
    expect(() => assertCanClose("OWNER", 0, false)).not.toThrow();
    expect(() => assertCanClose("OWNER", 100, false)).not.toThrow();
  });

  it("cajero cierra cuadrando sin autorización", () => {
    expect(() => assertCanClose("CASHIER", 0, false)).not.toThrow();
  });

  it("cajero con diferencia requiere autorización", () => {
    expect(() => assertCanClose("CASHIER", 100, false)).toThrow("OWNER_AUTHORIZATION_REQUIRED");
    expect(() => assertCanClose("CASHIER", -100, false)).toThrow("OWNER_AUTHORIZATION_REQUIRED");
    expect(() => assertCanClose("CASHIER", 100, true)).not.toThrow();
  });
});
