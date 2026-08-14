import { createHash } from "node:crypto";
import type { Role } from "@fiao/contracts/auth";
import type { CommandContext } from "@fiao/domain/context";
import { AuthRepository } from "@fiao/database";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "fiao_session";
export const ACTIVE_BRANCH_COOKIE_NAME = "fiao_branch";

export interface CurrentSession {
  sessionId: string;
  userId: string;
  ownerId: string;
  role: Role;
  deviceId: string;
}

export class SessionRequiredError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "SessionRequiredError";
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function requireSession(): Promise<CurrentSession> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) throw new SessionRequiredError();

  const repository = new AuthRepository();
  const session = await repository.findActiveSessionByTokenHash(hashSessionToken(rawToken), new Date());
  if (!session) throw new SessionRequiredError();

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    ownerId: session.ownerId,
    role: session.role,
    deviceId: session.deviceId
  };
}

export async function requireBranchContext(branchId: string): Promise<CommandContext> {
  const session = await requireSession();
  const repository = new AuthRepository();
  const access = await repository.verifyBranchAccess(session.userId, branchId);
  if (access.ownerId !== session.ownerId) throw new Error("FORBIDDEN");

  return {
    ownerId: access.ownerId,
    branchId: access.branchId,
    userId: session.userId,
    role: access.role,
    deviceId: session.deviceId,
    now: new Date()
  };
}
