import { createHash, randomBytes } from "node:crypto";
import { normalizePhoneDO } from "@fiao/contracts/common";
import { validatePin } from "@fiao/domain/auth/pin-policy";
import { AuthRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AttemptThrottle } from "@/lib/auth/attempt-throttle";
import { verifyPinHash as verifyArgon2idPinHash } from "@/lib/auth/pin-crypto";
import { ACTIVE_BRANCH_COOKIE_NAME, hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/session/current-session";

export const runtime = "nodejs";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
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
}) {
  const repository = dependencies?.repository ?? defaultRepository;
  const verifyPinHash = dependencies?.verifyPinHash ?? verifyArgon2idPinHash;
  const throttle = dependencies?.throttle ?? defaultThrottle;
  const now = dependencies?.now ?? Date.now;
  const randomToken = dependencies?.randomToken ?? (() => randomBytes(32).toString("base64url"));

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

    let pinMatches = false;
    try {
      pinMatches = await verifyPinHash(userRecord?.user.pinHash ?? DUMMY_PIN_HASH, parsed.data.pin);
    } catch {
      pinMatches = false;
    }

    if (!userRecord || !validatePin(parsed.data.pin) || !pinMatches) {
      throttle.recordFailure(key, currentTime);
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

    const activeBranchId = userRecord.branches[0]!.id;
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

export const POST = createLoginHandler();
