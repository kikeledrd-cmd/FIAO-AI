import type { SyncChangeRecord } from "@fiao/contracts/sync";
import { describe, expect, it } from "vitest";
import { reduceChange, reduceCreditChange, reduceCustomerChange, reduceSaleChange } from "./local-reducer";

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
        name: "Doña María",
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
  });

  it("rejects unknown types", () => {
    expect(() => reduceChange({ ...baseChange, type: "FROBNICATE" })).toThrow("UNKNOWN_SYNC_CHANGE_TYPE");
  });
});
