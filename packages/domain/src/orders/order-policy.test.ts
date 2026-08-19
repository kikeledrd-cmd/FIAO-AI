import { describe, expect, it } from "vitest";
import {
  assertOrderTransitionValid,
  finalizesSaleOnTransition,
  orderCancelRequiresAuthorization,
  reservesStockOnTransition
} from "./order-policy";

describe("order-policy", () => {
  it("permite el flujo feliz New → Preparing → Ready → On the way → Delivered", () => {
    expect(() => assertOrderTransitionValid("NEW", "PREPARING")).not.toThrow();
    expect(() => assertOrderTransitionValid("PREPARING", "READY")).not.toThrow();
    expect(() => assertOrderTransitionValid("READY", "ON_THE_WAY")).not.toThrow();
    expect(() => assertOrderTransitionValid("ON_THE_WAY", "DELIVERED")).not.toThrow();
  });

  it("permite cancelar en cualquier estado no terminal", () => {
    expect(() => assertOrderTransitionValid("NEW", "CANCELLED")).not.toThrow();
    expect(() => assertOrderTransitionValid("PREPARING", "CANCELLED")).not.toThrow();
    expect(() => assertOrderTransitionValid("ON_THE_WAY", "CANCELLED")).not.toThrow();
  });

  it("rechaza transiciones inválidas", () => {
    expect(() => assertOrderTransitionValid("NEW", "DELIVERED")).toThrow("INVALID_ORDER_TRANSITION");
    expect(() => assertOrderTransitionValid("DELIVERED", "CANCELLED")).toThrow("INVALID_ORDER_TRANSITION");
    expect(() => assertOrderTransitionValid("CANCELLED", "NEW")).toThrow("INVALID_ORDER_TRANSITION");
    expect(() => assertOrderTransitionValid("PREPARING", "NEW")).toThrow("INVALID_ORDER_TRANSITION");
  });

  it("la cancelación solo es libre antes de Preparing", () => {
    expect(orderCancelRequiresAuthorization("NEW")).toBe(false);
    expect(orderCancelRequiresAuthorization("PREPARING")).toBe(true);
    expect(orderCancelRequiresAuthorization("READY")).toBe(true);
    expect(orderCancelRequiresAuthorization("ON_THE_WAY")).toBe(true);
  });

  it("reserva stock al aceptar y finaliza venta al entregar", () => {
    expect(reservesStockOnTransition("PREPARING")).toBe(true);
    expect(reservesStockOnTransition("NEW")).toBe(false);
    expect(finalizesSaleOnTransition("DELIVERED")).toBe(true);
    expect(finalizesSaleOnTransition("READY")).toBe(false);
  });
});
