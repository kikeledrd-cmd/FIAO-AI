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

  async createProduct(branch: { ownerId: string; id: string }, overrides: Partial<{
    name: string;
    barcode: string | null;
    priceCents: number;
    stockControl: boolean;
    unitLabel: string;
    onHand: string;
  }> = {}) {
    const { onHand = "10", ...data } = overrides;
    return this.db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ownerId: branch.ownerId,
          branchId: branch.id,
          name: data.name ?? `Producto ${crypto.randomUUID().slice(0, 8)}`,
          barcode: data.barcode ?? null,
          priceCents: data.priceCents ?? 5000,
          stockControl: data.stockControl ?? true,
          unitLabel: data.unitLabel ?? "und"
        }
      });
      await tx.productStock.create({
        data: {
          ownerId: branch.ownerId,
          branchId: branch.id,
          productId: product.id,
          onHand
        }
      });
      return product;
    });
  }
}

function randomSevenDigits(): string {
  return String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
}
