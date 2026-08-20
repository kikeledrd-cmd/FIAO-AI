import type { Role } from "@fiao/contracts/auth";
import { databaseClient, type FiaoPrismaClient } from "../client";

export interface LoginUserRecord {
  user: {
    id: string;
    ownerId: string;
    name: string;
    phoneE164: string;
    pinHash: string;
    role: Role;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  };
  owner: {
    id: string;
    name: string;
  };
  branches: Array<{
    id: string;
    name: string;
    timezone: string;
  }>;
}

export interface CreateSessionInput {
  ownerId: string;
  userId: string;
  deviceId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface BranchAccess {
  ownerId: string;
  branchId: string;
  role: Role;
}

export interface UserContextRecord {
  user: {
    id: string;
    name: string;
    role: Role;
  };
  branches: Array<{
    id: string;
    name: string;
    timezone: string;
  }>;
}

export interface ActiveSessionRecord {
  sessionId: string;
  ownerId: string;
  userId: string;
  role: Role;
  deviceId: string;
  expiresAt: Date;
}

export interface OwnerAuthorizerRecord {
  id: string;
  pinHash: string;
}

export interface CreateOwnerAuthorizationInput {
  ownerId: string;
  branchId: string;
  authorizerUserId: string;
  purpose: string;
  targetOperationId: string;
  expiresAt: Date;
}

export class AuthRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async findActiveUserByPhone(phoneE164: string): Promise<LoginUserRecord | null> {
    const user = await this.db.user.findUnique({
      where: { phoneE164 },
      include: {
        owner: true,
        branchAssignments: {
          include: { branch: true }
        }
      }
    });

    if (!user || !user.active || !user.owner.active) return null;

    const branches = user.role === "OWNER"
      ? await this.db.branch.findMany({
          where: { ownerId: user.ownerId, active: true },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, timezone: true }
        })
      : user.branchAssignments
          .filter(({ branch }) => branch.active && branch.ownerId === user.ownerId)
          .map(({ branch }) => ({ id: branch.id, name: branch.name, timezone: branch.timezone }));

    return {
      user: {
        id: user.id,
        ownerId: user.ownerId,
        name: user.name,
        phoneE164: user.phoneE164,
        pinHash: user.pinHash,
        role: user.role as Role,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil
      },
      owner: {
        id: user.owner.id,
        name: user.owner.name
      },
      branches
    };
  }

  async updateLoginFailures(phoneE164: string, input: { failedLoginAttempts: number; lockedUntil: Date | null }): Promise<void> {
    await this.db.user.updateMany({
      where: { phoneE164 },
      data: { failedLoginAttempts: input.failedLoginAttempts, lockedUntil: input.lockedUntil }
    });
  }

  async clearLoginFailures(phoneE164: string): Promise<void> {
    await this.db.user.updateMany({
      where: { phoneE164 },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });
  }

  async findUserContext(userId: string, ownerId: string): Promise<UserContextRecord | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        owner: true,
        branchAssignments: {
          include: { branch: true }
        }
      }
    });

    if (!user || !user.active || !user.owner.active || user.ownerId !== ownerId) return null;

    const branches =
      user.role === "OWNER"
        ? await this.db.branch.findMany({
            where: { ownerId: user.ownerId, active: true },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, timezone: true }
          })
        : user.branchAssignments
            .filter(({ branch }) => branch.active && branch.ownerId === user.ownerId)
            .map(({ branch }) => ({ id: branch.id, name: branch.name, timezone: branch.timezone }));

    return {
      user: {
        id: user.id,
        name: user.name,
        role: user.role as Role
      },
      branches
    };
  }

  async createSession(input: CreateSessionInput): Promise<{ id: string; expiresAt: Date }> {
    const [user, device] = await Promise.all([
      this.db.user.findUnique({
        where: { id: input.userId },
        select: {
          ownerId: true,
          active: true,
          owner: { select: { active: true } }
        }
      }),
      this.db.device.findUnique({
        where: { id: input.deviceId },
        select: {
          ownerId: true,
          userId: true,
          active: true
        }
      })
    ]);

    if (
      !user ||
      !device ||
      !user.active ||
      !user.owner.active ||
      !device.active ||
      user.ownerId !== input.ownerId ||
      device.ownerId !== input.ownerId ||
      device.userId !== input.userId
    ) {
      throw new Error("FORBIDDEN");
    }

    const session = await this.db.session.create({
      data: {
        ownerId: input.ownerId,
        userId: input.userId,
        deviceId: input.deviceId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt
      },
      select: { id: true, expiresAt: true }
    });

    return session;
  }

  async createDevice(ownerId: string, userId: string, label: string): Promise<{ id: string }> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        ownerId: true,
        active: true,
        owner: { select: { active: true } }
      }
    });

    if (!user || !user.active || !user.owner.active || user.ownerId !== ownerId) {
      throw new Error("FORBIDDEN");
    }

    return this.db.device.create({
      data: { ownerId, userId, label },
      select: { id: true }
    });
  }

  async findActiveSessionByTokenHash(tokenHash: string, now: Date): Promise<ActiveSessionRecord | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        ownerId: true,
        userId: true,
        deviceId: true,
        expiresAt: true,
        revokedAt: true,
        owner: { select: { active: true } },
        user: { select: { active: true, role: true, ownerId: true } },
        device: { select: { active: true, ownerId: true, userId: true } }
      }
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !session.owner.active ||
      !session.user.active ||
      !session.device.active ||
      session.user.ownerId !== session.ownerId ||
      session.device.ownerId !== session.ownerId ||
      session.device.userId !== session.userId
    ) {
      return null;
    }

    return {
      sessionId: session.id,
      ownerId: session.ownerId,
      userId: session.userId,
      role: session.user.role as Role,
      deviceId: session.deviceId,
      expiresAt: session.expiresAt
    };
  }

  async revokeSessionByTokenHash(tokenHash: string, now: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now }
    });
  }

  async findActiveOwnerAuthorizers(ownerId: string): Promise<OwnerAuthorizerRecord[]> {
    const owner = await this.db.ownerAccount.findUnique({
      where: { id: ownerId },
      select: {
        active: true,
        users: {
          where: { role: "OWNER", active: true },
          select: { id: true, pinHash: true }
        }
      }
    });

    if (!owner?.active) return [];
    return owner.users;
  }

  async createOwnerAuthorization(input: CreateOwnerAuthorizationInput): Promise<{ id: string; expiresAt: Date }> {
    const [authorizer, branch] = await Promise.all([
      this.db.user.findUnique({
        where: { id: input.authorizerUserId },
        select: { ownerId: true, role: true, active: true, owner: { select: { active: true } } }
      }),
      this.db.branch.findUnique({
        where: { id: input.branchId },
        select: { ownerId: true, active: true }
      })
    ]);

    if (
      !authorizer ||
      !branch ||
      !authorizer.active ||
      !authorizer.owner.active ||
      !branch.active ||
      authorizer.role !== "OWNER" ||
      authorizer.ownerId !== input.ownerId ||
      branch.ownerId !== input.ownerId
    ) {
      throw new Error("FORBIDDEN");
    }

    return this.db.ownerAuthorization.create({
      data: input,
      select: { id: true, expiresAt: true }
    });
  }

  async verifyBranchAccess(userId: string, branchId: string): Promise<BranchAccess> {
    const [user, branch] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: {
          ownerId: true,
          role: true,
          active: true,
          owner: { select: { active: true } },
          branchAssignments: {
            where: { branchId },
            select: { branchId: true }
          }
        }
      }),
      this.db.branch.findUnique({
        where: { id: branchId },
        select: { ownerId: true, active: true }
      })
    ]);

    if (!user || !branch || !user.active || !user.owner.active || !branch.active) {
      throw new Error("FORBIDDEN");
    }
    if (user.ownerId !== branch.ownerId) {
      throw new Error("FORBIDDEN");
    }
    if (user.role === "CASHIER" && user.branchAssignments.length === 0) {
      throw new Error("FORBIDDEN");
    }

    return {
      ownerId: user.ownerId,
      branchId,
      role: user.role as Role
    };
  }
}
