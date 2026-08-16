import { ownerAuthorizeRequestSchema } from "@fiao/contracts/inventory";
import { ownerAuthorizationExpiresAt } from "@fiao/domain/auth/authorize-owner";
import { AuthRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { verifyPinHash as verifyArgon2idPinHash } from "@/lib/auth/pin-crypto";
import { requireSession as requireSessionDefault, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

type SessionLike = {
  sessionId: string;
  userId: string;
  ownerId: string;
  role: "OWNER" | "CASHIER";
  deviceId: string;
};

interface AuthorizeRepository {
  findActiveOwnerAuthorizers(ownerId: string): ReturnType<AuthRepository["findActiveOwnerAuthorizers"]>;
  createOwnerAuthorization(input: {
    ownerId: string;
    branchId: string;
    authorizerUserId: string;
    purpose: string;
    targetOperationId: string;
    expiresAt: Date;
  }): ReturnType<AuthRepository["createOwnerAuthorization"]>;
  verifyBranchAccess(userId: string, branchId: string): ReturnType<AuthRepository["verifyBranchAccess"]>;
}

export function createOwnerAuthorizeHandler(dependencies?: {
  repository?: AuthorizeRepository;
  verifyPinHash?: (hash: string, pin: string) => Promise<boolean>;
  now?: () => Date;
  requireSession?: () => Promise<SessionLike>;
}) {
  const repository = dependencies?.repository ?? new AuthRepository();
  const verifyPinHash = dependencies?.verifyPinHash ?? verifyArgon2idPinHash;
  const now = dependencies?.now ?? (() => new Date());
  const requireSession = dependencies?.requireSession ?? requireSessionDefault;

  return async function ownerAuthorize(request: Request): Promise<NextResponse> {
    let session;
    try {
      session = await requireSession();
    } catch (error) {
      if (error instanceof SessionRequiredError) {
        return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      }
      throw error;
    }

    const parsed = ownerAuthorizeRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const input = parsed.data;

    let branchAccess;
    try {
      branchAccess = await repository.verifyBranchAccess(session.userId, input.branchId);
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      throw error;
    }
    if (branchAccess.ownerId !== session.ownerId) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // Verificar el PIN contra cualquiera de los OWNER del dueño (no contra el
    // actor actual, que puede ser un cajero pidiendo autorización).
    const authorizers = await repository.findActiveOwnerAuthorizers(session.ownerId);
    if (authorizers.length === 0) {
      return NextResponse.json({ error: "NO_OWNER_AUTHORIZER" }, { status: 403 });
    }
    let matched: { id: string } | null = null;
    for (const authorizer of authorizers) {
      if (await verifyPinHash(authorizer.pinHash, input.pin)) {
        matched = authorizer;
        break;
      }
    }
    if (!matched) {
      return NextResponse.json({ error: "INVALID_OWNER_PIN" }, { status: 401 });
    }

    try {
      const created = await repository.createOwnerAuthorization({
        ownerId: session.ownerId,
        branchId: input.branchId,
        authorizerUserId: matched.id,
        purpose: input.purpose,
        targetOperationId: input.targetOperationId,
        expiresAt: ownerAuthorizationExpiresAt(now())
      });
      return NextResponse.json({
        authorizationId: created.id,
        expiresAt: created.expiresAt.toISOString()
      });
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      throw error;
    }
  };
}
