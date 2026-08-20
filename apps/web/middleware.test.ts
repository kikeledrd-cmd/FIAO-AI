import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

function request(method: string, url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method, headers });
}

describe("middleware CSRF", () => {
  it("deja pasar métodos seguros", async () => {
    const response = middleware(request("GET", "http://localhost/api/catalog"));
    expect(response.status).toBe(200);
  });

  it("rechaza una mutación cross-site por Origin", async () => {
    const response = middleware(
      request("POST", "http://localhost/api/sync/push", {
        origin: "https://evil.example",
        host: "localhost"
      })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CSRF_REJECTED" });
  });

  it("rechaza una mutación cross-site por Sec-Fetch-Site", async () => {
    const response = middleware(
      request("POST", "http://localhost/api/customers", {
        "sec-fetch-site": "cross-site",
        host: "localhost"
      })
    );
    expect(response.status).toBe(403);
  });

  it("permite una mutación same-origin", async () => {
    const response = middleware(
      request("POST", "http://localhost/api/sync/push", {
        origin: "http://localhost",
        host: "localhost",
        "sec-fetch-site": "same-origin"
      })
    );
    expect(response.status).toBe(200);
  });

  it("exime al webhook de WhatsApp (validado por HMAC)", async () => {
    const response = middleware(
      request("POST", "http://localhost/api/whatsapp/webhook", {
        "sec-fetch-site": "cross-site",
        host: "localhost"
      })
    );
    expect(response.status).toBe(200);
  });
});
