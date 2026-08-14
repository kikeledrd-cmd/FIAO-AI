import type { Role } from "@fiao/contracts/auth";

export type Permission =
  | "APP_READ"
  | "SYNC_PUSH"
  | "SYNC_PULL"
  | "OWNER_PROTECTED";

export function can(role: Role, permission: Permission): boolean {
  if (permission === "OWNER_PROTECTED") return role === "OWNER";
  return role === "OWNER" || role === "CASHIER";
}
