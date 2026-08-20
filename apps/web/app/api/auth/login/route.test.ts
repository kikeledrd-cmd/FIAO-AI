import { describe, expect, it, vi } from "vitest";
import type { CreateSessionInput, LoginUserRecord } from "@fiao/database";
import { AttemptThrottle } from "@/lib/auth/attempt-throttle";
import { createLoginHandler } from "./handler";

function request(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function validUser(): LoginUserRecord {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222222",
      name: "José Dueño",
      phoneE164: "+18095550123",
      pinHash: "argon-hash",
      role: "OWNER",
      failedLoginAttempts: 0,
      lockedUntil: null
    },
    owner: { id: "22222222-2222-4222-8222-222222222222", name: "Colmado El Primo" },
    branches: [{ id: "33333333-3333-4333-8333-333333333333", name: "Los Mina", timezone: "America/Santo_Domingo" }]
  };
}

function freshThrottle() {
  return new AttemptThrottle();
}

function repository(user: LoginUserRecord | null) {
  return {
    findActiveUserByPhone: vi.fn(async () => user),
    createDevice: vi.fn(async () => ({ id: "44444444-4444-4444-8444-444444444444" })),
    createSession: vi.fn(async (input: CreateSessionInput) => ({
      id: "55555555-5555-4555-8555-555555555555",
      expiresAt: input.expiresAt
    })),
    updateLoginFailures: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined)
  };
}

describe("POST /api/auth/login", () => {
  it("rejects an incorrect PIN without revealing whether the phone exists", async () => {
    const repo = repository(validUser());
    const POST = createLoginHandler({ repository: repo, verifyPinHash: async () => false, throttle: freshThrottle() });
    const response = await POST(request({ phone: "+18095550123", pin: "9999", deviceLabel: "Caja" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it("uses the same credential error when the phone does not exist", async () => {
    const POST = createLoginHandler({ repository: repository(null), verifyPinHash: async () => false, throttle: freshThrottle() });
    const response = await POST(request({ phone: "+18095550123", pin: "9999", deviceLabel: "Caja" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  });

  it("backs off repeated failed credential attempts", async () => {
    const POST = createLoginHandler({
      repository: repository(validUser()),
      verifyPinHash: async () => false,
      throttle: freshThrottle(),
      now: () => 1_000
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await POST(request({ phone: "+18095550123", pin: "9999", deviceLabel: "Caja" }));
      expect(response.status).toBe(401);
    }

    const blocked = await POST(request({ phone: "+18095550123", pin: "9999", deviceLabel: "Caja" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("1");
  });

  it("rejects a locked account with a retry-after", async () => {
    const user = validUser();
    user.user.lockedUntil = new Date(60_000);
    const repo = repository(user);
    const POST = createLoginHandler({
      repository: repo,
      verifyPinHash: async () => true,
      throttle: freshThrottle(),
      now: () => 0
    });

    const response = await POST(request({ phone: "+18095550123", pin: "1234", deviceLabel: "Caja" }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "ACCOUNT_LOCKED" });
    expect(response.headers.get("retry-after")).toBe("60");
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it("clears persisted lockout on successful login", async () => {
    const repo = repository(validUser());
    const POST = createLoginHandler({
      repository: repo,
      verifyPinHash: async () => true,
      throttle: freshThrottle(),
      randomToken: () => "token",
      now: () => Date.UTC(2026, 7, 13, 20, 0, 0)
    });

    await POST(request({ phone: "+18095550123", pin: "1234", deviceLabel: "Caja" }));

    expect(repo.clearLoginFailures).toHaveBeenCalledWith("+18095550123");
  });

  it("creates a hashed-token session for a valid active user", async () => {
    const repo = repository(validUser());
    const rawToken = "opaque-session-token";
    const POST = createLoginHandler({
      repository: repo,
      verifyPinHash: async () => true,
      throttle: freshThrottle(),
      randomToken: () => rawToken,
      now: () => Date.UTC(2026, 7, 13, 20, 0, 0)
    });
    const response = await POST(request({ phone: "+18095550123", pin: "1234", deviceLabel: "Caja" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("fiao_session=");
    expect(repo.createSession).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(repo.createSession.mock.calls[0]?.[0].tokenHash).not.toBe(rawToken);
  });
});
