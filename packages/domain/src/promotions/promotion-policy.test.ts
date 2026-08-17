import { describe, expect, it } from "vitest";
import { applyPromotions, type PromotionInput } from "./promotion-policy";

const NOW = new Date("2026-08-16T12:00:00.000Z");

const CART = [
  { productId: "p1", quantity: "2", priceCents: 10000 }, // 2 × RD$100
  { productId: "p2", quantity: "1", priceCents: 5000 } // 1 × RD$50
];

function promo(overrides: Partial<PromotionInput> & Pick<PromotionInput, "id" | "kind" | "scope">): PromotionInput {
  return {
    active: true,
    startsAt: null,
    endsAt: null,
    productId: null,
    percentOffCents: null,
    fixedOffCents: null,
    buyQty: null,
    getQty: null,
    ...overrides
  };
}

describe("promotion-policy", () => {
  it("sin promos activas: sin descuentos", () => {
    const result = applyPromotions(CART, [], NOW);
    expect(result.totalDiscountCents).toBe(0);
    expect(result.lines.every((line) => line.discountCents === 0)).toBe(true);
  });

  it("PERCENT_OFF de producto: 15% sobre la línea", () => {
    const result = applyPromotions(
      CART,
      [promo({ id: "pr1", kind: "PERCENT_OFF", scope: "PRODUCT", productId: "p1", percentOffCents: 1500 })],
      NOW
    );
    expect(result.totalDiscountCents).toBe(3000); // 15% de 20000
    expect(result.lines[0].discountCents).toBe(3000);
    expect(result.lines[0].promotionId).toBe("pr1");
    expect(result.lines[1].discountCents).toBe(0);
  });

  it("FIXED_OFF de producto: nunca excede el total de la línea", () => {
    const result = applyPromotions(
      CART,
      [promo({ id: "pr2", kind: "FIXED_OFF", scope: "PRODUCT", productId: "p2", fixedOffCents: 99999 })],
      NOW
    );
    expect(result.lines[1].discountCents).toBe(5000);
    expect(result.totalDiscountCents).toBe(5000);
  });

  it("BUNDLE_BUY_X_GET_Y: 2x1 en el producto (3 unidades → 1 gratis)", () => {
    const result = applyPromotions(
      [{ productId: "p1", quantity: "3", priceCents: 10000 }],
      [promo({ id: "pr3", kind: "BUNDLE_BUY_X_GET_Y", scope: "PRODUCT", productId: "p1", buyQty: 2, getQty: 1 })],
      NOW
    );
    // 3 unidades = bloque completo 2+1 → 1 gratis (RD$100)
    expect(result.lines[0].discountCents).toBe(10000);
    expect(result.totalDiscountCents).toBe(10000);
  });

  it("BUNDLE: unidades incompletas no descuentan", () => {
    const result = applyPromotions(
      [{ productId: "p1", quantity: "5", priceCents: 10000 }],
      [promo({ id: "pr3", kind: "BUNDLE_BUY_X_GET_Y", scope: "PRODUCT", productId: "p1", buyQty: 2, getQty: 1 })],
      NOW
    );
    // 5 unidades → 1 bloque completo de 3 (2+1) → 1 gratis (RD$100); sobran 2
    expect(result.totalDiscountCents).toBe(10000);
  });

  it("promo TOTAL compite contra la suma por línea (gana la mayor)", () => {
    const linePromo = promo({ id: "pl", kind: "PERCENT_OFF", scope: "PRODUCT", productId: "p1", percentOffCents: 5000 });
    const totalPromo = promo({ id: "pt", kind: "FIXED_OFF", scope: "TOTAL", fixedOffCents: 12000 });
    // Línea: 50% de 20000 = 10000. Total: 12000 fijo → gana el TOTAL.
    const result = applyPromotions(CART, [linePromo, totalPromo], NOW);
    expect(result.totalDiscountCents).toBe(12000);
    expect(result.appliedPromotionIds).toEqual(["pt"]);
    expect(result.lines.every((line) => line.discountCents === 0)).toBe(true);
  });

  it("por línea gana la promo de mayor descuento (no apilable)", () => {
    const smaller = promo({ id: "ps", kind: "FIXED_OFF", scope: "PRODUCT", productId: "p1", fixedOffCents: 1000 });
    const bigger = promo({ id: "pb", kind: "PERCENT_OFF", scope: "PRODUCT", productId: "p1", percentOffCents: 2500 });
    const result = applyPromotions(CART, [smaller, bigger], NOW);
    expect(result.lines[0].promotionId).toBe("pb");
    expect(result.lines[0].discountCents).toBe(5000); // 25% de 20000
  });

  it("promos inactivas o fuera de ventana no aplican", () => {
    const inactive = promo({ id: "px", kind: "FIXED_OFF", scope: "PRODUCT", productId: "p1", fixedOffCents: 1000, active: false });
    const past = promo({ id: "py", kind: "FIXED_OFF", scope: "PRODUCT", productId: "p1", fixedOffCents: 1000, endsAt: "2026-01-01T00:00:00.000Z" });
    const future = promo({ id: "pz", kind: "FIXED_OFF", scope: "PRODUCT", productId: "p1", fixedOffCents: 1000, startsAt: "2027-01-01T00:00:00.000Z" });
    const result = applyPromotions(CART, [inactive, past, future], NOW);
    expect(result.totalDiscountCents).toBe(0);
  });

  it("es determinística: mismo input → mismo output", () => {
    const promotions = [
      promo({ id: "pr1", kind: "PERCENT_OFF", scope: "PRODUCT", productId: "p1", percentOffCents: 1500 }),
      promo({ id: "pr3", kind: "BUNDLE_BUY_X_GET_Y", scope: "PRODUCT", productId: "p1", buyQty: 2, getQty: 1 }),
      promo({ id: "pt", kind: "FIXED_OFF", scope: "TOTAL", fixedOffCents: 2500 })
    ];
    const first = applyPromotions(CART, promotions, NOW);
    const second = applyPromotions(CART, promotions, NOW);
    expect(first).toEqual(second);
    expect(first.totalDiscountCents).toBeGreaterThan(0);
  });
});
