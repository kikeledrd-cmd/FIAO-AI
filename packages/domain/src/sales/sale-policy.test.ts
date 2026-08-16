import { describe, expect, it } from "vitest";
import type { SaleLine, SalePayment } from "@fiao/contracts/sales";
import {
  paymentTotalCents,
  saleLineTotalCents,
  subtotalCents,
  validateSale
} from "./sale-policy";

const line = (overrides: Partial<SaleLine> = {}): SaleLine => ({
  productId: "10000000-0000-4000-8000-000000000001",
  quantity: "1",
  priceCents: 5000,
  ...overrides
});

const payment = (overrides: Partial<SalePayment> = {}): SalePayment => ({
  method: "CASH",
  amountCents: 5000,
  ...overrides
});

describe("saleLineTotalCents", () => {
  it("calculates unit totals exactly", () => {
    expect(saleLineTotalCents(5000, "1")).toBe(5000);
    expect(saleLineTotalCents(5000, "2")).toBe(10000);
    expect(saleLineTotalCents(125, "10")).toBe(1250);
  });

  it("calculates fractional quantities without floating point drift", () => {
    expect(saleLineTotalCents(1000, "0.5")).toBe(500);
    expect(saleLineTotalCents(3050, "2.250")).toBe(6863); // 6862.5 -> 6863
    expect(saleLineTotalCents(999, "0.333")).toBe(333); // 332.667 -> 333
  });

  it("rejects invalid quantities and prices", () => {
    expect(() => saleLineTotalCents(5000, "0")).toThrow("INVALID_QUANTITY");
    expect(() => saleLineTotalCents(5000, "abc")).toThrow("INVALID_QUANTITY");
    expect(() => saleLineTotalCents(5000, "-1")).toThrow("INVALID_QUANTITY");
    expect(() => saleLineTotalCents(5000, "1.0000")).toThrow("INVALID_QUANTITY");
    expect(() => saleLineTotalCents(0, "1")).toThrow("INVALID_PRICE");
    expect(() => saleLineTotalCents(-5, "1")).toThrow("INVALID_PRICE");
  });
});

describe("subtotalCents", () => {
  it("sums line totals", () => {
    expect(subtotalCents([line({ priceCents: 1000 }), line({ priceCents: 2500, quantity: "2" })])).toBe(6000);
  });

  it("rejects an empty cart", () => {
    expect(() => subtotalCents([])).toThrow("EMPTY_LINES");
  });
});

describe("paymentTotalCents", () => {
  it("sums single and mixed payments", () => {
    expect(paymentTotalCents([payment()])).toBe(5000);
    expect(
      paymentTotalCents([payment({ method: "CASH", amountCents: 3000 }), payment({ method: "TRANSFER", amountCents: 2000 })])
    ).toBe(5000);
  });

  it("rejects empty, non-positive and duplicated methods", () => {
    expect(() => paymentTotalCents([])).toThrow("EMPTY_PAYMENTS");
    expect(() => paymentTotalCents([payment({ amountCents: 0 })])).toThrow("INVALID_PAYMENT");
    expect(() =>
      paymentTotalCents([payment({ method: "CASH" }), payment({ method: "CASH", amountCents: 1 })])
    ).toThrow("DUPLICATE_PAYMENT_METHOD");
  });
});

describe("validateSale", () => {
  it("accepts a cash sale when payments match the subtotal", () => {
    const result = validateSale([line({ priceCents: 4000 }), line({ priceCents: 1500, quantity: "2" })], [
      payment({ amountCents: 7000 })
    ]);
    expect(result).toEqual({ subtotalCents: 7000, totalCents: 7000 });
  });

  it("accepts mixed payments", () => {
    const result = validateSale([line({ priceCents: 5000 })], [
      payment({ method: "CASH", amountCents: 3000 }),
      payment({ method: "TRANSFER", amountCents: 2000 })
    ]);
    expect(result.totalCents).toBe(5000);
  });

  it("rejects when payments do not match the total", () => {
    expect(() => validateSale([line({ priceCents: 5000 })], [payment({ amountCents: 4999 })])).toThrow(
      "PAYMENT_TOTAL_MISMATCH"
    );
    expect(() => validateSale([line({ priceCents: 5000 })], [payment({ amountCents: 5001 })])).toThrow(
      "PAYMENT_TOTAL_MISMATCH"
    );
  });

  it("rejects a payment component larger than the total", () => {
    expect(() =>
      validateSale([line({ priceCents: 1000 })], [
        payment({ method: "CASH", amountCents: 1500 }),
        payment({ method: "CARD", amountCents: -500 })
      ])
    ).toThrow();
  });
});
