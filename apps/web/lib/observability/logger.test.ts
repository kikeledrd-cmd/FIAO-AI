import { describe, expect, it } from "vitest";
import { redactPii } from "./logger";

describe("redactPii", () => {
  it("redacta emails", () => {
    expect(redactPii("contacto juan@colmado.do ya")).toBe("contacto [email] ya");
  });

  it("redacta teléfonos E.164", () => {
    expect(redactPii("cliente +18095550123 vino")).toBe("cliente [phone] vino");
  });

  it("no redacta montos ni IDs numéricos cortos", () => {
    expect(redactPii("total 25000 centavos, id 123")).toBe("total 25000 centavos, id 123");
  });
});
