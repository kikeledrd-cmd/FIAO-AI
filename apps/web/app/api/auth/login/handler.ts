import { createHash, randomBytes } from "node:crypto";
import { normalizePhoneDO } from "@fiao/contracts/common";
import { validatePin } from "@fiao/domain/auth/pin-policy";
import { AuthRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AttemptThrottle } from "@/lib/auth/attempt-throttle";
import { verifyPinHash as verifyArgon2idPinHash } from "@/lib/auth/pin-crypto";
import { logger } from "@/lib/observability/logger";
import { ACTIVE_BRANCH_COOKIE_NAME, hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/session/current-session";

export const runtime = "nodejs";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;
const DUMMY_PIN_HASH = "$argon2id$v=19$m=65536,t=3,p=4$dZw/uAOzVoufNFLKz/n99A$fk1t5aJ46X8pHZpIfZISHJxK6CVDynRowITVHvR27zw";

const loginSchema = z.object({
  phone: z.string().min(1).max(40),
  pin: z.string().min(1).max(32),
  deviceLabel: z.string().trim().min(1).max(80).default("Este celular")
});

interface LoginRepository {
  findActiveUserByPhone(phoneE164: string): ReturnType<AuthRepository["findActiveUserByPhone"]>;
  createDevice(ownerId: string, userId: string, label: string): ReturnType<AuthRepository["createDevice"]>;
  createSession(input: Parameters<AuthRepository["createSession"]>[0]): ReturnType<AuthRepository["createSession"]>;
  updateLoginFailures(phoneE164: string, input: { failedLoginAttempts: number; lockedUntil: Date | null }): Promise<void>;
  clearLoginFailures(phoneE164: string): Promise<void>;
}

type LoginThrottle = Pick<AttemptThrottle, "remainingMs" | "recordFailure" | "clear">;

const defaultRepository = new AuthRepository();
const defaultThrottle = new AttemptThrottle();

function throttleKey(phone: string): string {
  return createHash("sha256").update(phone.trim(), "utf8").digest("hex");
}

function invalidCredentials() {
  return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
}

export function createLoginHandler(dependencies?: {
  repository?: LoginRepository;
  verifyPinHash?: (hash: string, pin: string) => Promise<boolean>;
  throttle?: LoginThrottle;
  now?: () => number;
  randomToken?: () => string;
  recordEvent?: (input: { ownerId: string; branchId: string; eventName: string }) => Promise<void>;
}) {
  const repository = dependencies?.repository ?? defaultRepository;
  const verifyPinHash = dependencies?.verifyPinHash ?? verifyArgon2idPinHash;
  const throttle = dependencies?.throttle ?? defaultThrottle;
  const now = dependencies?.now ?? Date.now;
  const randomToken = dependencies?.randomToken ?? (() => randomBytes(32).toString("base64url"));
  const recordEvent = dependencies?.recordEvent ?? (async () => undefined);

  return async function login(request: Request): Promise<NextResponse> {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidCredentials();

    let phoneE164: string;
    try {
      phoneE164 = normalizePhoneDO(parsed.data.phone);
    } catch {
      phoneE164 = parsed.data.phone.trim();
    }

    const key = throttleKey(phoneE164);
    const currentTime = now();
    const waitMs = throttle.remainingMs(key, currentTime);
    if (waitMs > 0) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS" },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(waitMs / 1000))) } }
      );
    }

    const normalized = (() => {
      try {
        return normalizePhoneDO(parsed.data.phone);
      } catch {
        return null;
      }
    })();
    const userRecord = normalized ? await repository.findActiveUserByPhone(normalized) : null;

    // Lockout persistente (capa DB) además del throttle en memoria.
    if (userRecord && userRecord.user.lockedUntil && userRecord.user.lockedUntil.getTime() > currentTime) {
      const waitMs = userRecord.user.lockedUntil.getTime() - currentTime;
      return NextResponse.json(
        { error: "ACCOUNT_LOCKED" },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(waitMs / 1000))) } }
      );
    }

    let pinMatches = false;
    try {
      pinMatches = await verifyPinHash(userRecord?.user.pinHash ?? DUMMY_PIN_HASH, parsed.data.pin);
    } catch {
      pinMatches = false;
    }

    if (!userRecord || !validatePin(parsed.data.pin) || !pinMatches) {
      throttle.recordFailure(key, currentTime);
      logger.warn("auth.login.failed", { phoneHash: key });
      if (userRecord) {
        const failures = userRecord.user.failedLoginAttempts + 1;
        const exponent = Math.max(0, failures - MAX_FREE_ATTEMPTS);
        const backoffMs = failures <= MAX_FREE_ATTEMPTS ? 0 : Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);
        await repository.updateLoginFailures(userRecord.user.phoneE164, {
          failedLoginAttempts: failures,
          lockedUntil: backoffMs > 0 ? new Date(currentTime + backoffMs) : null
        });
      }
      return invalidCredentials();
    }

    if (userRecord.branches.length === 0) {
      return NextResponse.json({ error: "NO_BRANCH_ACCESS" }, { status: 403 });
    }

    const device = await repository.createDevice(
      userRecord.user.ownerId,
      userRecord.user.id,
      parsed.data.deviceLabel
    );
    const rawToken = randomToken();
    const expiresAt = new Date(currentTime + SESSION_TTL_MS);
    await repository.createSession({
      ownerId: userRecord.user.ownerId,
      userId: userRecord.user.id,
      deviceId: device.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt
    });
    throttle.clear(key);
    await repository.clearLoginFailures(userRecord.user.phoneE164);
    const activeBranchId = userRecord.branches[0]!.id;
    logger.info("auth.login.success", { ownerId: userRecord.user.ownerId, role: userRecord.user.role, branchCount: userRecord.branches.length });
    await recordEvent({ ownerId: userRecord.user.ownerId, branchId: activeBranchId, eventName: "USER_LOGIN" });

    const response = NextResponse.json({
      user: {
        id: userRecord.user.id,
        name: userRecord.user.name,
        role: userRecord.user.role
      },
      branches: userRecord.branches,
      activeBranchId
    });

    const secure = process.env.NODE_ENV === "production";
    response.cookies.set(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt
    });
    response.cookies.set(ACTIVE_BRANCH_COOKIE_NAME, activeBranchId, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt
    });
    return response;
  };
}
