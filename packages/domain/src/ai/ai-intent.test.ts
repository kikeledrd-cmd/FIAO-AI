import { describe, expect, it } from "vitest";
import {
  detectAnomalousAmount,
  extractAmountCents,
  isAiActionTool,
  isAiQueryTool,
  normalizeAiText,
  parseAiIntent
} from "./ai-intent";

describe("normalizeAiText", () => {
  it("minúsculas, sin acentos ni puntuación", () => {
    expect(normalizeAiText("¿Cuánto Vendí hoy?")).toBe("cuanto vendi hoy");
  });
});

describe("extractAmountCents", () => {
  it("extrae RD$500", () => {
    expect(extractAmountCents("abona RD$500 a María")).toBe(50000);
  });
  it("extrae '50 pesos'", () => {
    expect(extractAmountCents("cobra 50 pesos a Rafael")).toBe(5000);
  });
  it("extrae '500.25 pesos'", () => {
    expect(extractAmountCents("500.25 pesos")).toBe(50025);
  });
  it("devuelve null sin monto", () => {
    expect(extractAmountCents("cuánto vendí hoy")).toBeNull();
  });
});

describe("parseAiIntent", () => {
  it("clasifica consulta de ventas", () => {
    const intent = parseAiIntent("¿cuánto vendí hoy?");
    expect(intent.kind).toBe("QUERY");
    expect(intent.tool).toBe("SALES_SUMMARY");
  });

  it("clasifica consulta de cartera/fiado", () => {
    const intent = parseAiIntent("quién me debe dinero");
    expect(intent.tool).toBe("CREDIT_SUMMARY");
  });

  it("clasifica consulta de saldo de cliente con nombre crudo", () => {
    const intent = parseAiIntent("cuánto me debe María");
    expect(intent.tool).toBe("CUSTOMER_BALANCE");
    expect(intent.parameters.customerQuery).toBe("maria");
  });

  it("clasifica acción de abono con monto", () => {
    const intent = parseAiIntent("abona 500 pesos a Rafael");
    expect(intent.kind).toBe("ACTION");
    expect(intent.tool).toBe("REGISTER_ABONO");
    expect(intent.parameters.amountCents).toBe(50000);
    expect(intent.parameters.customerQuery).toBe("rafael");
  });

  it("clasifica acción de abrir caja", () => {
    const intent = parseAiIntent("abrir caja con 2000");
    expect(intent.tool).toBe("OPEN_CASH");
    expect(intent.parameters.amountCents).toBe(200000);
  });

  it("clasifica 'abre la caja' como acción", () => {
    const intent = parseAiIntent("abre la caja con 2000");
    expect(intent.tool).toBe("OPEN_CASH");
    expect(intent.parameters.amountCents).toBe(200000);
  });

  it("clasifica inventario y caja como consultas", () => {
    expect(parseAiIntent("qué me falta en inventario").tool).toBe("INVENTORY_STATUS");
    expect(parseAiIntent("cuánto hay en caja").tool).toBe("CASH_STATUS");
  });

  it("marca ambigüedad de cliente en saldo sin nombre", () => {
    const intent = parseAiIntent("saldo de 500 pesos");
    expect(intent.tool).toBe("CUSTOMER_BALANCE");
    expect(intent.ambiguities).toContain("customer");
  });

  it("fallback determinístico sin intent reconocido", () => {
    const intent = parseAiIntent("xyz abc");
    expect(intent.ambiguities).toContain("intent");
  });
});

describe("type guards", () => {
  it("distingue query y action", () => {
    expect(isAiQueryTool("SALES_SUMMARY")).toBe(true);
    expect(isAiActionTool("REGISTER_ABONO")).toBe(true);
    expect(isAiQueryTool("REGISTER_ABONO")).toBe(false);
    expect(isAiActionTool("SALES_SUMMARY")).toBe(false);
  });
});

describe("detectAnomalousAmount", () => {
  it("marca montos por encima del umbral típico", () => {
    expect(detectAnomalousAmount(50000, 20000)).toBe(true);
    expect(detectAnomalousAmount(10000, 20000)).toBe(false);
  });
  it("ignora montos inválidos", () => {
    expect(detectAnomalousAmount(0, 20000)).toBe(false);
    expect(detectAnomalousAmount(-100, 20000)).toBe(false);
  });
});
