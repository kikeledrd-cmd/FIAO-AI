import { validatePin } from "@fiao/domain/auth/pin-policy";
import { ownerAuthorizationExpiresAt } from "@fiao/domain/auth/authorize-owner";
import { AuthRepository } from "@fiao/database";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AttemptThrottle } from "@/lib/auth/attempt-throttle";
import { verifyPinHash } from "@/lib/auth/pin-crypto";
import { ACTIVE_BRANCH_COOKIE_NAME, requireBranchContext, requireSession, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const ownerAuthorizationThrottle = new AttemptThrottle({ threshold: 3, baseBackoffMs: 1_000, maxBackoffMs: 16_000 });

const schema = z.object({
  pin: z.string().min(1).max(32),
  purpose: z.string().trim().min(1).max(64).regex(/^[A-Z0-9_:-]+$/),
  targetOperationId: z.uuid()
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const session = await requireSession();
    const cookieStore = await cookies();
    const branchId = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
    if (!branchId) {
      return NextResponse.json({ error: "BRANCH_REQUIRED" }, { status: 400 });
    }
    await requireBranchContext(branchId);

    const throttleKey = session.sessionId;
    const now = Date.now();
    const waitMs = ownerAuthorizationThrottle.remainingMs(throttleKey, now);
    if (waitMs > 0) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS" },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(waitMs / 1000))) } }
      );
    }

    const repository = new AuthRepository();
    const ownerUsers = await repository.findActiveOwnerAuthorizers(session.ownerId);
    const checks = await Promise.all(ownerUsers.map(async (ownerUser) => ({
      ownerUser,
      matches: await verifyPinHash(ownerUser.pinHash, body.data.pin)
    })));
    const authorizer = validatePin(body.data.pin) ? checks.find(({ matches }) => matches)?.ownerUser : undefined;
    if (!authorizer) {
      ownerAuthorizationThrottle.recordFailure(throttleKey, now);
      return NextResponse.json({ error: "INVALID_AUTHORIZATION" }, { status: 401 });
    }
    ownerAuthorizationThrottle.clear(throttleKey);

    const expiresAt = ownerAuthorizationExpiresAt(new Date(now));
    const authorization = await repository.createOwnerAuthorization({
      ownerId: session.ownerId,
      branchId,
      authorizerUserId: authorizer.id,
      purpose: body.data.purpose,
      targetOperationId: body.data.targetOperationId,
      expiresAt
    });

    return NextResponse.json({
      authorizationId: authorization.id,
      expiresAt: authorization.expiresAt.toISOString()
    });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw error;
  }
}
