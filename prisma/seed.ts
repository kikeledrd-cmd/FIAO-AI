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

    await seedCatalog(tx, ownerAccount.id, BRANCH_LOS_MINA_ID);
    await seedCatalog(tx, ownerAccount.id, BRANCH_INVIVIENDA_ID);
  });

  console.log("Seed complete: owner + cashier + 2 branches + catalog (Los Mina, Invivienda).");
}

const DEMO_CATALOG = [
  { name: "Arroz La Garza 5lb", barcode: "7501003110031", priceCents: 27500, unitLabel: "und", onHand: "40" },
  { name: "Habichuelas Rojas 1lb", barcode: "8400000000012", priceCents: 9500, unitLabel: "lb", onHand: "25" },
  { name: "Aceite Crisol 1L", barcode: "8400000000029", priceCents: 28500, unitLabel: "und", onHand: "18" },
  { name: "Azúcar 2lb", barcode: "8400000000036", priceCents: 8900, unitLabel: "und", onHand: "30" },
  { name: "Sardinas Rico 425g", barcode: "8400000000043", priceCents: 11500, unitLabel: "und", onHand: "24" },
  { name: "Leche Entera 1L", barcode: "8400000000050", priceCents: 14500, unitLabel: "und", onHand: "20" },
  { name: "Huevos 30", barcode: "8400000000067", priceCents: 18500, unitLabel: "cartón", onHand: "15" },
  { name: "Pan Sobao", barcode: "8400000000074", priceCents: 2500, unitLabel: "und", onHand: "60" },
  { name: "Recarga RD$100", barcode: null, priceCents: 10000, stockControl: false, unitLabel: "recarga", onHand: null },
  { name: "Plátanos 1lb", barcode: "8400000000081", priceCents: 3500, unitLabel: "lb", onHand: "50" }
] as const;

async function seedCatalog(tx: Parameters<Parameters<typeof databaseClient.$transaction>[0]>[0], ownerId: string, branchId: string) {
  for (const item of DEMO_CATALOG) {
    const product = await tx.product.upsert({
      where: { branchId_barcode: { branchId, barcode: item.barcode ?? `none-${item.name}` } },
      update: {
        name: item.name,
        priceCents: item.priceCents,
        stockControl: item.stockControl ?? true,
        unitLabel: item.unitLabel
      },
      create: {
        ownerId,
        branchId,
        name: item.name,
        barcode: item.barcode ?? null,
        priceCents: item.priceCents,
        stockControl: item.stockControl ?? true,
        unitLabel: item.unitLabel
      }
    });
    if ((item.stockControl ?? true) && item.onHand !== null) {
      const stock = await tx.productStock.findUnique({ where: { productId: product.id } });
      if (!stock) {
        await tx.productStock.create({
          data: { ownerId, branchId, productId: product.id, onHand: item.onHand }
        });
      }
    }
  }
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => databaseClient.$disconnect());
