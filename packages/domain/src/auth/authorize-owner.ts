import type { Role } from "@fiao/contracts/auth";

export const OWNER_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

export interface OwnerAuthorizationScope {
  ownerId: string;
  branchId: string;
  purpose: string;
  targetOperationId: string;
}

export function isOwnerAuthorizer(role: Role): boolean {
  return role === "OWNER";
}

export function ownerAuthorizationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + OWNER_AUTHORIZATION_TTL_MS);
}
