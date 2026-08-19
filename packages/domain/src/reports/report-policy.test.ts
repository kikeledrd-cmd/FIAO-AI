import { describe, expect, it } from "vitest";
import {
  estimatedProfitCents,
  percentChange,
  previousPeriodStart,
  profitLabel,
  startOfDay,
  stockLabel
} from "./report-policy";

describe("startOfDay / previousPeriodStart", () => {
  it("marca medianoche local", () => {
    const now = new Date("2026-08-19T14:30:00");
    const start = startOfDay(now);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("período anterior de N días", () => {
    const now = new Date("2026-08-19T10:00:00");
    const previous = previousPeriodStart(now, 7);
    expect(previous.toISOString()).toBe("2026-08-12T04:00:00.000Z");
  });
});

describe("percentChange", () => {
  it("calcula variación entera", () => {
    expect(percentChange(15000, 10000)).toBe(50);
  });
  it("devuelve null sin base", () => {
    expect(percentChange(5000, 0)).toBeNull();
  });
});

describe("estimatedProfitCents / profitLabel", () => {
  it("ganancia = subtotal − costo", () => {
    expect(estimatedProfitCents(100000, 60000)).toBe(40000);
  });
  it("la ganancia siempre es ESTIMATED", () => {
    expect(profitLabel()).toBe("ESTIMATED");
  });
});

describe("stockLabel", () => {
  it("clasifica agotado, bajo y ok", () => {
    expect(stockLabel(0, 3)).toBe("RECOMMENDATION");
    expect(stockLabel(2, 3)).toBe("ESTIMATED");
    expect(stockLabel(10, 3)).toBe("CONFIRMED");
  });
});
