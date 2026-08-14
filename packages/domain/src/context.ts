import type { Role } from "@fiao/contracts/auth";

export interface CommandContext {
  ownerId: string;
  branchId: string;
  userId: string;
  role: Role;
  deviceId: string;
  now: Date;
}
