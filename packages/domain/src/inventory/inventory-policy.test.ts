import { describe, expect, it } from "vitest";
import { applyStockDelta, parseAdjustmentDelta } from "./inventory-policy";

describe("parseAdjustmentDelta", () => {
  it("parses positive, negative and fractional deltas", () => {
    expect(parseAdjustmentDelta("5")).toBe("5");
    expect(parseAdjustmentDelta("-2")).toBe("-2");
    expect(parseAdjustmentDelta("0.5")).toBe("0.5");
    expect(parseAdjustmentDelta("-1.250")).toBe("-1.25");
    expect(parseAdjustmentDelta("+3")).toBe("3");
  });

  it("rejects zero, non-numeric and malformed deltas", () => {
    expect(() => parseAdjustmentDelta("0")).toThrow("INVALID_ADJUSTMENT_DELTA");
    expect(() => parseAdjustmentDelta("-0")).toThrow("INVALID_ADJUSTMENT_DELTA");
    expect(() => parseAdjustmentDelta("abc")).toThrow("INVALID_ADJUSTMENT_DELTA");
    expect(() => parseAdjustmentDelta("1.2345")).toThrow("INVALID_ADJUSTMENT_DELTA");
    expect(() => parseAdjustmentDelta("--1")).toThrow("INVALID_ADJUSTMENT_DELTA");
  });
});

describe("applyStockDelta", () => {
  it("adds a positive delta to onHand", () => {
    expect(applyStockDelta("10", "5")).toBe("15");
    expect(applyStockDelta("0", "0.5")).toBe("0.5");
  });

  it("subtracts a negative delta from onHand", () => {
    expect(applyStockDelta("10", "-2")).toBe("8");
    expect(applyStockDelta("1", "-0.250")).toBe("0.75");
  });

  it("rejects a delta that would make onHand negative", () => {
    expect(() => applyStockDelta("2", "-3")).toThrow("STOCK_NEGATIVE");
    expect(() => applyStockDelta("0.5", "-0.501")).toThrow("STOCK_NEGATIVE");
    expect(() => applyStockDelta("1", "-1.001")).toThrow("STOCK_NEGATIVE");
  });

  it("rejects a delta on an item without stock control", () => {
    expect(() => applyStockDelta(null, "5")).toThrow("STOCK_CONTROL_REQUIRED");
  });
});
