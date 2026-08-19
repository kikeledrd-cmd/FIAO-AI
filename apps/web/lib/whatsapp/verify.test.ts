import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractInboundText, toE164, verifyWebhookSignature } from "./verify";

const SECRET = "test-app-secret";

function sign(rawBody: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("acepta una firma válida", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rechaza una firma inválida", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyWebhookSignature(body, "sha256=deadbeef", SECRET)).toBe(false);
  });

  it("rechaza cuando no hay header", () => {
    expect(verifyWebhookSignature("{}", null, SECRET)).toBe(false);
  });
});

describe("toE164", () => {
  it("añade + cuando falta", () => {
    expect(toE164("18095550123")).toBe("+18095550123");
  });
  it("conserva el + si ya está", () => {
    expect(toE164("+18095550123")).toBe("+18095550123");
  });
});

describe("extractInboundText", () => {
  it("extrae el primer mensaje de texto", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "18095550123", type: "text", text: { body: "2 arroces y una leche" } }
                ]
              }
            }
          ]
        }
      ]
    };
    expect(extractInboundText(body)).toEqual({
      fromPhoneE164: "+18095550123",
      text: "2 arroces y una leche"
    });
  });

  it("devuelve null sin mensajes de texto", () => {
    expect(extractInboundText({ object: "whatsapp_business_account", entry: [] })).toBeNull();
    expect(extractInboundText({})).toBeNull();
    expect(extractInboundText(null)).toBeNull();
  });

  it("ignora mensajes que no son de texto", () => {
    const body = {
      entry: [{ changes: [{ value: { messages: [{ from: "18095550123", type: "image" }] } }] }]
    };
    expect(extractInboundText(body)).toBeNull();
  });
});
