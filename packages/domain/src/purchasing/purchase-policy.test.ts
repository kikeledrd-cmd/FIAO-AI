import { describe, expect, it } from "vitest";
import { assertPurchaseLineValid, computeMovingAverageCost } from "./purchase-policy";

describe("computeMovingAverageCost", () => {
  it("uses the purchase unit cost when there is no previous stock", () => {
    expect(computeMovingAverageCost(0, "0", 8500, "5")).toBe(8500);
  });

  it("keeps the same cost when the purchase matches the current cost", () => {
    expect(computeMovingAverageCost(8500, "10", 8500, "5")).toBe(8500);
  });

  it("computes a weighted average with whole quantities", () => {
    // (8500*10 + 8000*10) / 20 = 8250
    expect(computeMovingAverageCost(8500, "10", 8000, "10")).toBe(8250);
  });

  it("rounds with a fixed rule when the division is not exact", () => {
    // (10000*1 + 1*1)/2 = 5000.5 -> 5001 (half away from zero)
    expect(computeMovingAverageCost(10000, "1", 1, "1")).toBe(5001);
  });

  it("handles fractional quantities with milésima precision", () => {
    // (8500*10 + 8000*0.5) / 10.5 = (85000+4000)/10.5 = 89000/10.5 ≈ 8476.19 -> 8476
    expect(computeMovingAverageCost(8500, "10", 8000, "0.5")).toBe(8476);
  });

  it("is deterministic across repeated calls", () => {
    const first = computeMovingAverageCost(8500, "10", 8000, "5");
    const second = computeMovingAverageCost(8500, "10", 8000, "5");
    expect(first).toBe(second);
  });

  it("rejects negative or zero costs and quantities", () => {
    expect(() => computeMovingAverageCost(-1, "10", 8000, "5")).toThrow("INVALID_COST");
    expect(() => computeMovingAverageCost(8500, "10", -1, "5")).toThrow("INVALID_COST");
    expect(() => computeMovingAverageCost(8500, "-1", 8000, "5")).toThrow("INVALID_QUANTITY");
    expect(() => computeMovingAverageCost(8500, "10", 8000, "0")).toThrow("INVALID_QUANTITY");
  });
});

describe("assertPurchaseLineValid", () => {
  it("accepts a valid line", () => {
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "5", unitCostCents: 8500 }, true)).not.toThrow();
  });

  it("rejects a zero or negative unit cost", () => {
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "5", unitCostCents: 0 }, true)).toThrow("INVALID_UNIT_COST");
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "5", unitCostCents: -1 }, true)).toThrow("INVALID_UNIT_COST");
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "0", unitCostCents: 100 }, true)).toThrow("INVALID_QUANTITY");
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "-2", unitCostCents: 100 }, true)).toThrow("INVALID_QUANTITY");
  });

  it("rejects a line for a product without stock control", () => {
    expect(() => assertPurchaseLineValid({ productId: "p1", quantity: "5", unitCostCents: 100 }, false)).toThrow("STOCK_CONTROL_REQUIRED");
  });
});
