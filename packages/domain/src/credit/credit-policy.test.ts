import { describe, expect, it } from "vitest";
import {
  computeFiaoScore,
  creditBalanceCents,
  parseMoneyCents,
  assertCreditLimit,
  assertAbonoValid,
  type CreditMovementInput
} from "./credit-policy";

function movement(type: "FIAO_SALE" | "ABONO", amountCents: number, occurredAt = "2026-08-01T12:00:00Z"): CreditMovementInput {
  return { type, amountCents, occurredAt };
}

describe("parseMoneyCents", () => {
  it("parses decimal amounts into integer cents", () => {
    expect(parseMoneyCents("100")).toBe(10000);
    expect(parseMoneyCents("100.50")).toBe(10050);
    expect(parseMoneyCents("0.05")).toBe(5);
    expect(parseMoneyCents("1,234.56")).toBe(123456);
  });

  it("rejects invalid or non-positive amounts", () => {
    expect(() => parseMoneyCents("")).toThrow("INVALID_AMOUNT");
    expect(() => parseMoneyCents("0")).toThrow("INVALID_AMOUNT");
    expect(() => parseMoneyCents("-5")).toThrow("INVALID_AMOUNT");
    expect(() => parseMoneyCents("abc")).toThrow("INVALID_AMOUNT");
    expect(() => parseMoneyCents("1.234")).toThrow("INVALID_AMOUNT");
  });
});

describe("creditBalanceCents", () => {
  it("computes balance from append-only movements", () => {
    const movements = [
      movement("FIAO_SALE", 50000),
      movement("FIAO_SALE", 25000),
      movement("ABONO", 10000),
      movement("ABONO", 5000)
    ];
    expect(creditBalanceCents(movements)).toBe(60000);
  });

  it("returns zero with no movements", () => {
    expect(creditBalanceCents([])).toBe(0);
  });

  it("rejects an unknown movement type", () => {
    expect(() => creditBalanceCents([{ type: "OTRO", amountCents: 1, occurredAt: "" } as unknown as CreditMovementInput])).toThrow("UNKNOWN_CREDIT_MOVEMENT");
  });
});

describe("assertCreditLimit", () => {
  it("allows a fiado within the limit", () => {
    expect(() => assertCreditLimit(40000, 10000, 50000)).not.toThrow();
  });

  it("allows an exact fit", () => {
    expect(() => assertCreditLimit(40000, 10000, 50000)).not.toThrow();
  });

  it("rejects when the new balance exceeds the limit", () => {
    expect(() => assertCreditLimit(40000, 15000, 50000)).toThrow("CREDIT_LIMIT_EXCEEDED");
  });
});

describe("assertAbonoValid", () => {
  it("allows an abono up to the current balance", () => {
    expect(() => assertAbonoValid(50000, 50000)).not.toThrow();
  });

  it("rejects an abono that exceeds the balance", () => {
    expect(() => assertAbonoValid(50000, 50001)).toThrow("ABONO_EXCEEDS_BALANCE");
  });

  it("rejects an abono when there is no debt", () => {
    expect(() => assertAbonoValid(0, 100)).toThrow("ABONO_EXCEEDS_BALANCE");
  });
});

describe("computeFiaoScore", () => {
  it("scores 100 with no credit history (neutral)", () => {
    const result = computeFiaoScore({ total: 0, onTime: 0 });
    expect(result.score).toBe(100);
    expect(result.explanation.toLowerCase()).toContain("sin historial");
  });

  it("scores 100 when every abono was on time", () => {
    const result = computeFiaoScore({ total: 5, onTime: 5 });
    expect(result.score).toBe(100);
    expect(result.onTime).toBe(5);
    expect(result.late).toBe(0);
  });

  it("penalizes late abonos proportionally", () => {
    const result = computeFiaoScore({ total: 4, onTime: 3 });
    expect(result.score).toBe(75);
    expect(result.late).toBe(1);
  });

  it("floors at zero", () => {
    const result = computeFiaoScore({ total: 10, onTime: 0 });
    expect(result.score).toBe(0);
  });

  it("is explainable: exposes total, onTime and late", () => {
    const result = computeFiaoScore({ total: 3, onTime: 2 });
    expect(result).toMatchObject({ total: 3, onTime: 2, late: 1, score: 66 });
    expect(result.explanation).toContain("2");
    expect(result.explanation).toContain("1");
  });
});
