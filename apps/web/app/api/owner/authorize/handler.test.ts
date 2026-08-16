import { createOwnerAuthorizeHandler } from "./handler";
import { describe, expect, it, vi } from "vitest";

function session(): { sessionId: string; userId: string; ownerId: string; role: "OWNER" | "CASHIER"; deviceId: string } {
  return {
    sessionId: "session-1",
    userId: "user-cashier",
    ownerId: "owner-1",
    role: "CASHIER" as const,
    deviceId: "device-1"
  };
}

function repository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findActiveOwnerAuthorizers: vi.fn(async () => [{ id: "owner-user-1", pinHash: "hash" }]),
    createOwnerAuthorization: vi.fn(async () => ({
      id: "authorization-1",
      expiresAt: new Date("2026-08-16T20:00:00.000Z")
    })),
    verifyBranchAccess: vi.fn(async () => ({ ownerId: "owner-1", branchId: "branch-1", role: "CASHIER" })),
    ...overrides
  };
}

function makeHandler(deps: {
  repository?: ReturnType<typeof repository>;
  verifyPinHash?: (hash: string, pin: string) => Promise<boolean>;
  now?: () => Date;
  requireSession?: () => Promise<ReturnType<typeof session>>;
}) {
  return createOwnerAuthorizeHandler({
    ...(deps.repository ? { repository: deps.repository as never } : {}),
    ...(deps.verifyPinHash ? { verifyPinHash: deps.verifyPinHash } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    requireSession: deps.requireSession ?? (async () => session())
  });
}

function post(handler: ReturnType<typeof createOwnerAuthorizeHandler>, body: unknown) {
  return handler(new Request("http://localhost/api/owner/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
}

const TARGET_OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const BRANCH_ID = "00000000-0000-4000-8000-000000000002";

describe("owner/authorize", () => {
  it("emits an authorization when the OWNER PIN matches", async () => {
    const repo = repository();
    const handler = makeHandler({
      repository: repo,
      verifyPinHash: vi.fn(async (hash: string, pin: string) => pin === "1234")
    });
    const response = await post(handler, {
      branchId: BRANCH_ID,
      purpose: "SALE_REVERSAL",
      targetOperationId: TARGET_OPERATION_ID,
      pin: "1234"
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authorizationId).toBe("authorization-1");
    expect(body.expiresAt).toBe("2026-08-16T20:00:00.000Z");
    expect(repo.createOwnerAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        branchId: BRANCH_ID,
        authorizerUserId: "owner-user-1",
        purpose: "SALE_REVERSAL",
        targetOperationId: TARGET_OPERATION_ID
      })
    );
  });

  it("rejects a wrong PIN", async () => {
    const repo = repository();
    const handler = makeHandler({
      repository: repo,
      verifyPinHash: vi.fn(async () => false)
    });
    const response = await post(handler, {
      branchId: BRANCH_ID,
      purpose: "STOCK_ADJUSTMENT",
      targetOperationId: TARGET_OPERATION_ID,
      pin: "9999"
    });

    expect(response.status).toBe(401);
    expect(repo.createOwnerAuthorization).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const repo = repository();
    const handler = makeHandler({ repository: repo, verifyPinHash: vi.fn(async () => true) });
    const response = await post(handler, { branchId: BRANCH_ID, pin: "1234" });

    expect(response.status).toBe(400);
    expect(repo.createOwnerAuthorization).not.toHaveBeenCalled();
  });

  it("rejects when the branch is not accessible", async () => {
    const repo = repository({
      verifyBranchAccess: vi.fn(async () => { throw new Error("FORBIDDEN"); })
    });
    const handler = makeHandler({ repository: repo, verifyPinHash: vi.fn(async () => true) });
    const response = await post(handler, {
      branchId: BRANCH_ID,
      purpose: "STOCK_ADJUSTMENT",
      targetOperationId: TARGET_OPERATION_ID,
      pin: "1234"
    });

    expect(response.status).toBe(403);
  });

  it("rejects without a session", async () => {
    const { SessionRequiredError } = await import("@/lib/session/current-session");
    const repo = repository();
    const handler = makeHandler({
      repository: repo,
      verifyPinHash: vi.fn(async () => true),
      requireSession: async () => { throw new SessionRequiredError(); }
    });
    const response = await post(handler, {
      branchId: BRANCH_ID,
      purpose: "STOCK_ADJUSTMENT",
      targetOperationId: TARGET_OPERATION_ID,
      pin: "1234"
    });

    expect(response.status).toBe(401);
    expect(repo.createOwnerAuthorization).not.toHaveBeenCalled();
  });
});
