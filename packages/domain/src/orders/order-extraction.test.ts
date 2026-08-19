import { describe, expect, it } from "vitest";
import { extractOrderLines, normalizeOrderText } from "./order-extraction";

const CATALOG = [
  { productId: "p-arroz", name: "Arroz La Garza 5lb" },
  { productId: "p-leche", name: "Leche Entera 1L" },
  { productId: "p-huevos", name: "Huevos 30" },
  { productId: "p-platano", name: "Plátanos 1lb" }
];

describe("normalizeOrderText", () => {
  it("normaliza mayúsculas, acentos y puntuación", () => {
    expect(normalizeOrderText("Dos Arroces, por favor!")).toBe("dos arroces por favor");
  });
});

describe("extractOrderLines", () => {
  it("extrae líneas con cantidad numérica previa", () => {
    const result = extractOrderLines("2 arroces y una leche", CATALOG);
    expect(result.lines).toEqual([
      { productId: "p-arroz", quantity: "2" },
      { productId: "p-leche", quantity: "1" }
    ]);
    expect(result.ambiguities).toEqual([]);
  });

  it("extrae cantidad con unidad de peso (5 libras de plátano)", () => {
    const result = extractOrderLines("dame 5 libras de plátano", CATALOG);
    expect(result.lines).toEqual([{ productId: "p-platano", quantity: "5" }]);
  });

  it("default a 1 cuando no hay número", () => {
    const result = extractOrderLines("quiero huevos", CATALOG);
    expect(result.lines).toEqual([{ productId: "p-huevos", quantity: "1" }]);
  });

  it("reporta términos que no resuelven a ningún producto", () => {
    const result = extractOrderLines("2 arroces y una coca", CATALOG);
    expect(result.lines).toEqual([{ productId: "p-arroz", quantity: "2" }]);
    expect(result.ambiguities).toContain("coca");
  });

  it("ignora stopwords como ambigüedad", () => {
    const result = extractOrderLines("hola dame arroz por favor", CATALOG);
    expect(result.ambiguities).toEqual([]);
  });

  it("no duplica un producto mencionado varias veces", () => {
    const result = extractOrderLines("arroz y arroz", CATALOG);
    expect(result.lines).toEqual([{ productId: "p-arroz", quantity: "1" }]);
  });
});
