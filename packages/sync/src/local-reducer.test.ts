import type { SyncChangeRecord } from "@fiao/contracts/sync";
import { describe, expect, it } from "vitest";
import {
  reduceApartadoChange,
  reduceCashMovementChange,
  reduceCashSessionChange,
  reduceChange,
  reduceCreditChange,
  reduceCustomerChange,
  reduceLoyaltyChange,
  reducePurchaseChange,
  reduceReversalChange,
  reduceSaleChange,
  reduceStockAdjustmentChange,
  reduceSupplierChange
} from "./local-reducer";

const baseChange: SyncChangeRecord = {
  cursor: "42",
  ownerId: "30000000-0000-4000-8000-000000000001",
  branchId: "10000000-0000-4000-8000-000000000001",
  type: "SALE",
  payload: {
    saleId: "40000000-0000-4000-8000-000000000001",
    lines: [{ productId: "50000000-0000-4000-8000-000000000001", quantity: "2", priceCents: 5500 }],
    payments: [{ method: "CASH", amountCents: 11000 }],
    subtotalCents: 11000,
    totalCents: 11000
  },
  createdAt: "2026-08-16T12:00:00.000Z"
};

describe("reduceSaleChange", () => {
  it("projects a SALE change keyed by owner/branch/saleId", () => {
    const row = reduceSaleChange(baseChange);
    expect(row.key).toBe(
      "30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:SALE:40000000-0000-4000-8000-000000000001"
    );
    expect(row.type).toBe("SALE");
    expect(row.cursor).toBe("42");
    expect(row.payload).toEqual(baseChange.payload);
  });

  it("rejects malformed SALE payloads", () => {
    expect(() => reduceSaleChange({ ...baseChange, payload: { nope: true } })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
    expect(() => reduceSaleChange({ ...baseChange, type: "NOOP" })).toThrow("UNKNOWN_SYNC_CHANGE_TYPE");
  });
});

describe("reduceCustomerChange", () => {
  it("projects a CUSTOMER change keyed by owner/branch/customerId", () => {
    const row = reduceCustomerChange({
      ...baseChange,
      type: "CUSTOMER",
      payload: {
        customerId: "60000000-0000-4000-8000-000000000001",
        name: "DoÃƒÂ±a MarÃƒÂ­a",
        phoneE164: "+18095550001",
        creditLimitCents: 100000,
        defaultPromiseDays: 7,
        active: true
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:CUSTOMER:60000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("CUSTOMER");
  });

  it("rejects malformed CUSTOMER payloads", () => {
    expect(() => reduceCustomerChange({ ...baseChange, type: "CUSTOMER", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceCreditChange", () => {
  it("projects a CREDIT change keyed by movementId", () => {
    const row = reduceCreditChange({
      ...baseChange,
      type: "CREDIT",
      payload: {
        movementId: "70000000-0000-4000-8000-000000000001",
        type: "FIAO_SALE",
        customerId: "60000000-0000-4000-8000-000000000001",
        amountCents: 5500,
        saleId: "40000000-0000-4000-8000-000000000001",
        abonoId: null,
        occurredAt: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:CREDIT:70000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("CREDIT");
  });

  it("rejects malformed CREDIT payloads", () => {
    expect(() => reduceCreditChange({ ...baseChange, type: "CREDIT", payload: { amountCents: 1 } })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceStockAdjustmentChange", () => {
  it("projects a STOCK_ADJUSTMENT change keyed by adjustmentId", () => {
    const row = reduceStockAdjustmentChange({
      ...baseChange,
      type: "STOCK_ADJUSTMENT",
      payload: {
        adjustmentId: "80000000-0000-4000-8000-000000000001",
        productId: "50000000-0000-4000-8000-000000000001",
        quantityDelta: "5",
        reason: "Compra",
        onHandAfter: "15",
        occurredAt: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:STOCK_ADJUSTMENT:80000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("STOCK_ADJUSTMENT");
  });

  it("rejects malformed STOCK_ADJUSTMENT payloads", () => {
    expect(() => reduceStockAdjustmentChange({ ...baseChange, type: "STOCK_ADJUSTMENT", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceReversalChange", () => {
  it("projects a REVERSAL change keyed by reversalId", () => {
    const row = reduceReversalChange({
      ...baseChange,
      type: "REVERSAL",
      payload: {
        reversalId: "90000000-0000-4000-8000-000000000001",
        saleId: "40000000-0000-4000-8000-000000000001",
        lines: [{ productId: "50000000-0000-4000-8000-000000000001", quantity: "2" }],
        reason: "DevoluciÃƒÂ³n",
        fiadoReversedCents: 0,
        occurredAt: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:REVERSAL:90000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("REVERSAL");
  });

  it("rejects malformed REVERSAL payloads", () => {
    expect(() => reduceReversalChange({ ...baseChange, type: "REVERSAL", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceSupplierChange", () => {
  it("projects a SUPPLIER change keyed by supplierId", () => {
    const row = reduceSupplierChange({
      ...baseChange,
      type: "SUPPLIER",
      payload: {
        supplierId: "a0000000-0000-4000-8000-000000000001",
        name: "Distribuidora La Vega",
        phoneE164: "+18095551111",
        active: true
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:SUPPLIER:a0000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("SUPPLIER");
  });

  it("rejects malformed SUPPLIER payloads", () => {
    expect(() => reduceSupplierChange({ ...baseChange, type: "SUPPLIER", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reducePurchaseChange", () => {
  it("projects a PURCHASE change keyed by purchaseId", () => {
    const row = reducePurchaseChange({
      ...baseChange,
      type: "PURCHASE",
      payload: {
        purchaseId: "b0000000-0000-4000-8000-000000000001",
        supplierId: null,
        lines: [{ productId: "50000000-0000-4000-8000-000000000001", quantity: "5", unitCostCents: 8000 }],
        costAfter: [{ productId: "50000000-0000-4000-8000-000000000001", costCents: 8000 }],
        note: null,
        totalCents: 40000,
        occurredAt: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:PURCHASE:b0000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("PURCHASE");
  });

  it("rejects malformed PURCHASE payloads", () => {
    expect(() => reducePurchaseChange({ ...baseChange, type: "PURCHASE", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceCashSessionChange", () => {
  it("projects a CASH_OPEN change keyed by sessionId", () => {
    const row = reduceCashSessionChange({
      ...baseChange,
      type: "CASH_OPEN",
      payload: {
        sessionId: "70000000-0000-4000-8000-000000000001",
        branchId: "10000000-0000-4000-8000-000000000001",
        openingFloatCents: 200000,
        openedAt: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:CASH_SESSION:70000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("CASH_OPEN");
  });

  it("projects a CASH_CLOSE change with the same session key", () => {
    const row = reduceCashSessionChange({
      ...baseChange,
      type: "CASH_CLOSE",
      payload: {
        sessionId: "70000000-0000-4000-8000-000000000001",
        countedCents: 195000,
        expectedCents: 200000,
        differenceCents: -5000,
        closedAt: "2026-08-16T20:00:00.000Z"
      }
    });
    expect(row.key).toContain(":CASH_SESSION:70000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("CASH_CLOSE");
  });

  it("rejects malformed CASH_OPEN payloads", () => {
    expect(() => reduceCashSessionChange({ ...baseChange, type: "CASH_OPEN", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceCashMovementChange", () => {
  it("projects a CASH_EXPENSE change keyed by movementId", () => {
    const row = reduceCashMovementChange({
      ...baseChange,
      type: "CASH_EXPENSE",
      payload: {
        movementId: "80000000-0000-4000-8000-000000000001",
        sessionId: "70000000-0000-4000-8000-000000000001",
        type: "EXPENSE",
        amountCents: 50000,
        category: "Agua",
        description: "BotellÃƒÂ³n",
        reason: null,
        occurredAt: "2026-08-16T13:00:00.000Z"
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:CASH_MOVEMENT:80000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("CASH_EXPENSE");
  });

  it("rejects malformed CASH_INJECTION payloads", () => {
    expect(() =>
      reduceCashMovementChange({ ...baseChange, type: "CASH_INJECTION", payload: { sessionId: "x" } })
    ).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });

  it("rejects non-cash movement types", () => {
    expect(() => reduceCashMovementChange({ ...baseChange, type: "SALE" })).toThrow("UNKNOWN_SYNC_CHANGE_TYPE");
  });
});

describe("reduceChange", () => {
  it("dispatches by change type", () => {
    expect(reduceChange(baseChange).type).toBe("SALE");
    expect(
      reduceChange({
        ...baseChange,
        type: "NOOP",
        payload: { operationId: "40000000-0000-4000-8000-000000000002" }
      }).type
    ).toBe("NOOP");
    expect(
      reduceChange({
        ...baseChange,
        type: "CUSTOMER",
        payload: { customerId: "60000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("CUSTOMER");
    expect(
      reduceChange({
        ...baseChange,
        type: "CREDIT",
        payload: {
          movementId: "70000000-0000-4000-8000-000000000001",
          customerId: "60000000-0000-4000-8000-000000000001"
        }
      }).type
    ).toBe("CREDIT");
    expect(
      reduceChange({
        ...baseChange,
        type: "STOCK_ADJUSTMENT",
        payload: { adjustmentId: "80000000-0000-4000-8000-000000000001", productId: "50000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("STOCK_ADJUSTMENT");
    expect(
      reduceChange({
        ...baseChange,
        type: "REVERSAL",
        payload: { reversalId: "90000000-0000-4000-8000-000000000001", saleId: "40000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("REVERSAL");
    expect(
      reduceChange({
        ...baseChange,
        type: "SUPPLIER",
        payload: { supplierId: "a0000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("SUPPLIER");
    expect(
      reduceChange({
        ...baseChange,
        type: "PURCHASE",
        payload: { purchaseId: "b0000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("PURCHASE");
    expect(
      reduceChange({
        ...baseChange,
        type: "APARTADO",
        payload: { apartadoId: "c0000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("APARTADO");
    expect(
      reduceChange({
        ...baseChange,
        type: "LOYALTY",
        payload: { movementId: "d0000000-0000-4000-8000-000000000001", customerId: "60000000-0000-4000-8000-000000000001" }
      }).type
    ).toBe("LOYALTY");
  });

  it("rejects unknown types", () => {
    expect(() => reduceChange({ ...baseChange, type: "FROBNICATE" })).toThrow("UNKNOWN_SYNC_CHANGE_TYPE");
  });
});

describe("reduceApartadoChange", () => {
  it("projects an APARTADO change keyed by owner/branch/apartadoId", () => {
    const row = reduceApartadoChange({
      ...baseChange,
      type: "APARTADO",
      payload: {
        apartadoId: "c0000000-0000-4000-8000-000000000001",
        customerId: "60000000-0000-4000-8000-000000000001",
        status: "ACTIVE",
        lines: [{ productId: "50000000-0000-4000-8000-000000000001", quantity: "2", priceCents: 5500 }],
        depositCents: 5000,
        totalCents: 11000
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:APARTADO:c0000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("APARTADO");
  });

  it("rejects malformed APARTADO payloads", () => {
    expect(() => reduceApartadoChange({ ...baseChange, type: "APARTADO", payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});

describe("reduceLoyaltyChange", () => {
  it("projects a LOYALTY change keyed by movementId", () => {
    const row = reduceLoyaltyChange({
      ...baseChange,
      type: "LOYALTY",
      payload: {
        movementId: "d0000000-0000-4000-8000-000000000001",
        customerId: "60000000-0000-4000-8000-000000000001",
        type: "EARN",
        pointsDelta: 110
      }
    });
    expect(row.key).toBe("30000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:LOYALTY:d0000000-0000-4000-8000-000000000001");
    expect(row.type).toBe("LOYALTY");
  });

  it("rejects malformed LOYALTY payloads", () => {
    expect(() => reduceLoyaltyChange({ ...baseChange, type: "LOYALTY", payload: { movementId: "x" } })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});