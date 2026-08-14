import { databaseClient, type FiaoPrismaClient } from "@fiao/database/client";

export const TEST_PIN_HASH = "$argon2id$v=19$m=65536,t=3,p=4$dZw/uAOzVoufNFLKz/n99A$fk1t5aJ46X8pHZpIfZISHJxK6CVDynRowITVHvR27zw";

export class TestFactory {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async ownerWithTwoBranchesAndCashier() {
    return this.db.$transaction(async (tx) => {
      const owner = await tx.ownerAccount.create({
        data: { name: `Test Owner ${crypto.randomUUID()}` }
      });
      const branchA = await tx.branch.create({
        data: { ownerId: owner.id, name: "Los Mina" }
      });
      const branchB = await tx.branch.create({
        data: { ownerId: owner.id, name: "Invivienda" }
      });
      const ownerUser = await tx.user.create({
        data: {
          ownerId: owner.id,
          name: "José Dueño",
          phoneE164: `+1809${randomSevenDigits()}`,
          pinHash: TEST_PIN_HASH,
          role: "OWNER"
        }
      });
      const cashier = await tx.user.create({
        data: {
          ownerId: owner.id,
          name: "Carlos Cajero",
          phoneE164: `+1829${randomSevenDigits()}`,
          pinHash: TEST_PIN_HASH,
          role: "CASHIER"
        }
      });

      return { owner, branchA, branchB, ownerUser, cashier };
    });
  }

  async assignUserToBranch(userId: string, branchId: string) {
    return this.db.userBranch.create({
      data: { userId, branchId }
    });
  }

  async createDeviceForUser(ownerId: string, userId: string, label = "Test device") {
    return this.db.device.create({
      data: { ownerId, userId, label }
    });
  }
}

function randomSevenDigits(): string {
  return String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
}
