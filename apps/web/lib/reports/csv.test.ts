import type { CsvRow } from "@fiao/contracts/reports";
import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("genera encabezados y filas", () => {
    const rows: CsvRow[] = [
      { name: "Arroz", priceCents: 5000 },
      { name: "Habichuela", priceCents: 6000 }
    ];
    expect(toCsv(rows)).toBe("name,priceCents\nArroz,5000\nHabichuela,6000");
  });

  it("escapa comas y comillas", () => {
    const rows: CsvRow[] = [{ name: 'Pan, "grande"', priceCents: 100 }];
    expect(toCsv(rows)).toBe('name,priceCents\n"Pan, ""grande""",100');
  });

  it("devuelve vacío para cero filas", () => {
    expect(toCsv([])).toBe("");
  });

  it("serializa booleanos/valores como string", () => {
    const rows: CsvRow[] = [{ name: "P1", active: 1 }];
    expect(toCsv(rows)).toBe("name,active\nP1,1");
  });
});
