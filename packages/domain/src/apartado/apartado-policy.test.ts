import { describe, expect, it } from "vitest";
import {
  addReservation,
  assertApartadoCreateValid,
  assertApartadoLineValid,
  assertApartadoTransitionValid,
  availableQuantity,
  releaseReservation
} from "./apartado-policy";

const LINE = {
  productId: "p1",
  quantity: "2",
  priceCents: 5000,
  onHand: "10",
  reserved: "0"
};

describe("apartado-policy", () => {
  it("availableQuantity = onHand − reserved", () => {
    expect(availableQuantity("10", "3.5")).toBe("6.5");
    expect(availableQuantity("10", "10")).toBe("0");
    expect(availableQuantity("0", "5")).toBe("0");
  });

  it("acepta una línea válida con stock suficiente", () => {
    expect(() => assertApartadoLineValid(LINE)).not.toThrow();
  });

  it("rechaza cantidad cero o negativa", () => {
    expect(() =>
      assertApartadoLineValid({ ...LINE, quantity: "0" })
    ).toThrow("INVALID_QUANTITY");
    expect(() =>
      assertApartadoLineValid({ ...LINE, quantity: "-1" })
    ).toThrow("INVALID_QUANTITY");
  });

  it("rechaza precio inválido", () => {
    expect(() =>
      assertApartadoLineValid({ ...LINE, priceCents: 0 })
    ).toThrow("INVALID_PRICE");
  });

  it("rechaza stock insuficiente considerando reservas", () => {
    expect(() =>
      assertApartadoLineValid({ ...LINE, quantity: "8", onHand: "10", reserved: "3" })
    ).toThrow("INSUFFICIENT_STOCK");
    expect(() =>
      assertApartadoLineValid({ ...LINE, quantity: "7", onHand: "10", reserved: "3" })
    ).not.toThrow();
  });

  it("valida la creación: anticipo en [0, total]", () => {
    expect(() =>
      assertApartadoCreateValid({ lines: [LINE], depositCents: 2000, totalCents: 10000 })
    ).not.toThrow();
    expect(() =>
      assertApartadoCreateValid({ lines: [LINE], depositCents: 11000, totalCents: 10000 })
    ).toThrow("DEPOSIT_EXCEEDS_TOTAL");
    expect(() =>
      assertApartadoCreateValid({ lines: [LINE], depositCents: -1, totalCents: 10000 })
    ).toThrow("INVALID_DEPOSIT");
    expect(() =>
      assertApartadoCreateValid({ lines: [], depositCents: 0, totalCents: 10000 })
    ).toThrow("EMPTY_LINES");
  });

  it("solo permite transiciones ACTIVE → COMPLETED|CANCELLED", () => {
    expect(() => assertApartadoTransitionValid("ACTIVE", "COMPLETED")).not.toThrow();
    expect(() => assertApartadoTransitionValid("ACTIVE", "CANCELLED")).not.toThrow();
    expect(() => assertApartadoTransitionValid("COMPLETED", "ACTIVE")).toThrow(
      "INVALID_APARTADO_TRANSITION"
    );
    expect(() => assertApartadoTransitionValid("CANCELLED", "COMPLETED")).toThrow(
      "INVALID_APARTADO_TRANSITION"
    );
  });

  it("reserva y libera cantidades decimales", () => {
    expect(addReservation("0", "1.5")).toBe("1.5");
    expect(addReservation("1.5", "0.5")).toBe("2");
    expect(releaseReservation("2", "1.5")).toBe("0.5");
    expect(releaseReservation("1", "3")).toBe("0");
  });
});
