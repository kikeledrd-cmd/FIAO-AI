import { describe, expect, it } from "vitest";
import {
  assertRedemptionAllowed,
  computeLoyaltyBalance,
  computePointsEarned,
  loyaltyExpiresAt
} from "./loyalty-policy";

const NOW = new Date("2026-08-16T12:00:00.000Z");

describe("loyalty-policy", () => {
  it("computePointsEarned: 1 punto por cada RD$100 (floor)", () => {
    expect(computePointsEarned(10_000, 100)).toBe(100);
    expect(computePointsEarned(15_000, 100)).toBe(150);
    expect(computePointsEarned(15_499, 100)).toBe(154);
    expect(computePointsEarned(0, 100)).toBe(0);
    expect(computePointsEarned(50, 100)).toBe(0);
  });

  it("computePointsEarned rechaza tasas inválidas", () => {
    expect(() => computePointsEarned(1000, 0)).toThrow("INVALID_POINTS_RATE");
    expect(() => computePointsEarned(-1, 100)).toThrow("INVALID_TOTAL");
  });

  it("balance suma earns no vencidos y resta redeems/reversals", () => {
    const movements = [
      { type: "EARN" as const, pointsDelta: 50, occurredAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-10-30T00:00:00.000Z" },
      { type: "EARN" as const, pointsDelta: 30, occurredAt: "2026-08-02T00:00:00.000Z", expiresAt: "2026-10-31T00:00:00.000Z" },
      { type: "REDEEM" as const, pointsDelta: -20, occurredAt: "2026-08-10T00:00:00.000Z" }
    ];
    expect(computeLoyaltyBalance(movements, NOW, 180)).toBe(60);
  });

  it("ignora earns vencidos", () => {
    const movements = [
      { type: "EARN" as const, pointsDelta: 50, occurredAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-07-01T00:00:00.000Z" },
      { type: "EARN" as const, pointsDelta: 30, occurredAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }
    ];
    expect(computeLoyaltyBalance(movements, NOW, 180)).toBe(30);
  });

  it("el balance nunca es negativo", () => {
    const movements = [{ type: "REDEEM" as const, pointsDelta: -50, occurredAt: "2026-08-10T00:00:00.000Z" }];
    expect(computeLoyaltyBalance(movements, NOW, 180)).toBe(0);
  });

  it("loyaltyExpiresAt suma días en UTC", () => {
    expect(loyaltyExpiresAt("2026-08-16T12:00:00.000Z", 90)).toBe(
      "2026-11-14T12:00:00.000Z"
    );
  });

  it("assertRedemptionAllowed: saldo suficiente y recompensa activa", () => {
    expect(() =>
      assertRedemptionAllowed({ balance: 100, pointsCost: 80, rewardActive: true })
    ).not.toThrow();
    expect(() =>
      assertRedemptionAllowed({ balance: 79, pointsCost: 80, rewardActive: true })
    ).toThrow("INSUFFICIENT_POINTS");
    expect(() =>
      assertRedemptionAllowed({ balance: 100, pointsCost: 80, rewardActive: false })
    ).toThrow("REWARD_INACTIVE");
  });
});
