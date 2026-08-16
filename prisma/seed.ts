import "dotenv/config";
import * as argon2 from "argon2";
import { databaseClient } from "@fiao/database";

const OWNER_ACCOUNT_ID = "30000000-0000-4000-8000-000000000001";
const BRANCH_LOS_MINA_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_INVIVIENDA_ID = "10000000-0000-4000-8000-000000000002";
const OWNER_USER_ID = "20000000-0000-4000-8000-000000000001";
const CASHIER_USER_ID = "20000000-0000-4000-8000-000000000002";

const SEED_OWNER_PHONE = process.env.FIAO_SEED_OWNER_PHONE ?? "+18095550123";
const SEED_OWNER_PIN = process.env.FIAO_SEED_OWNER_PIN ?? "1234";
const SEED_CASHIER_PHONE = process.env.FIAO_SEED_CASHIER_PHONE ?? "+18095550999";
const SEED_CASHIER_PIN = process.env.FIAO_SEED_CASHIER_PIN ?? "5678";

async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, { type: argon2.argon2id });
}

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SEED_DISABLED_IN_PRODUCTION");
  }

  const [ownerPinHash, cashierPinHash] = await Promise.all([hashPin(SEED_OWNER_PIN), hashPin(SEED_CASHIER_PIN)]);

  await databaseClient.$transaction(async (tx) => {
    const ownerAccount = await tx.ownerAccount.upsert({
      where: { id: OWNER_ACCOUNT_ID },
      update: { name: "Colmado Demo", active: true },
      create: { id: OWNER_ACCOUNT_ID, name: "Colmado Demo" }
    });

    await tx.branch.upsert({
      where: { id: BRANCH_LOS_MINA_ID },
      update: { ownerId: ownerAccount.id, name: "Los Mina", active: true },
      create: { id: BRANCH_LOS_MINA_ID, ownerId: ownerAccount.id, name: "Los Mina" }
    });
    await tx.branch.upsert({
      where: { id: BRANCH_INVIVIENDA_ID },
      update: { ownerId: ownerAccount.id, name: "Invivienda", active: true },
      create: { id: BRANCH_INVIVIENDA_ID, ownerId: ownerAccount.id, name: "Invivienda" }
    });

    await tx.user.upsert({
      where: { phoneE164: SEED_OWNER_PHONE },
      update: { ownerId: ownerAccount.id, name: "Dueño Demo", pinHash: ownerPinHash, role: "OWNER", active: true },
      create: { id: OWNER_USER_ID, ownerId: ownerAccount.id, name: "Dueño Demo", phoneE164: SEED_OWNER_PHONE, pinHash: ownerPinHash, role: "OWNER" }
    });

    const cashier = await tx.user.upsert({
      where: { phoneE164: SEED_CASHIER_PHONE },
      update: { ownerId: ownerAccount.id, name: "Cajero Demo", pinHash: cashierPinHash, role: "CASHIER", active: true },
      create: { id: CASHIER_USER_ID, ownerId: ownerAccount.id, name: "Cajero Demo", phoneE164: SEED_CASHIER_PHONE, pinHash: cashierPinHash, role: "CASHIER" }
    });

    // Cashier is assigned ONLY to Los Mina; Invivienda stays owner-only.
    const assignment = await tx.userBranch.findFirst({ where: { userId: cashier.id, branchId: BRANCH_LOS_MINA_ID } });
    if (!assignment) {
      await tx.userBranch.create({ data: { userId: cashier.id, branchId: BRANCH_LOS_MINA_ID } });
    }
  });

  console.log("Seed complete: owner + cashier + 2 branches (Los Mina, Invivienda).");
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => databaseClient.$disconnect());
