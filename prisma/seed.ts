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

    // Limpieza idempotente del historial comercial del dueño demo
    // (corridas E2E previas acumulan ventas/stock/saldo). Orden por FK Restrict.
    await tx.syncChange.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.loyaltyMovement.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.loyaltyReward.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.loyaltyConfig.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.promotion.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.apartadoLine.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.creditMovement.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.sale.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.apartado.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.order.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.cashMovement.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.cashSession.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.purchaseLine.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.purchase.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.supplier.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.stockMovement.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.auditEvent.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.aiAuditLog.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.aiActionToken.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.clientOperation.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.customer.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.productStock.deleteMany({ where: { ownerId: ownerAccount.id } });
    await tx.product.deleteMany({ where: { ownerId: ownerAccount.id } });

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
    await seedCustomers(tx, ownerAccount.id, BRANCH_LOS_MINA_ID);
    await seedCustomers(tx, ownerAccount.id, BRANCH_INVIVIENDA_ID);
    await seedLoyaltyAndPromotions(tx, ownerAccount.id, BRANCH_LOS_MINA_ID);
  });

  console.log("Seed complete: owner + cashier + 2 branches + catalog + customers + loyalty/promos.");
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

const DEMO_CUSTOMERS = [
  { name: "Doña María Peña", phoneE164: "+18095550001", creditLimitCents: 100000, defaultPromiseDays: 7, seedSuffix: "0001" },
  { name: "Don Rafael Marte", phoneE164: "+18095550002", creditLimitCents: 50000, defaultPromiseDays: 7, seedSuffix: "0002" },
  { name: "Yenny Rosario", phoneE164: "+18095550003", creditLimitCents: 25000, defaultPromiseDays: 3, seedSuffix: "0003" }
] as const;

/** customerId derivado por sucursal (el id es único global por dueño). */
function customerIdForBranch(suffix: string, branchId: string): string {
  const branchNum = branchId === BRANCH_INVIVIENDA_ID ? "2" : "1";
  return `40000000-0000-4000-8000-${branchNum}0000000${suffix}`;
}

async function seedCustomers(tx: Parameters<Parameters<typeof databaseClient.$transaction>[0]>[0], ownerId: string, branchId: string) {
  for (const item of DEMO_CUSTOMERS) {
    const customerPublicId = customerIdForBranch(item.seedSuffix, branchId);
    const customer = await tx.customer.upsert({
      where: { customerId: customerPublicId },
      update: {
        name: item.name,
        phoneE164: item.phoneE164,
        creditLimitCents: item.creditLimitCents,
        defaultPromiseDays: item.defaultPromiseDays,
        active: true
      },
      create: {
        ownerId,
        branchId,
        customerId: customerPublicId,
        name: item.name,
        phoneE164: item.phoneE164,
        creditLimitCents: item.creditLimitCents,
        defaultPromiseDays: item.defaultPromiseDays
      }
    });
    // Saldo inicial demo: Doña María debe RD$800 (dentro de su límite de RD$1,000).
    if (item.seedSuffix === "0001") {
      await tx.creditMovement.create({
        data: {
          ownerId,
          branchId,
          customerId: customer.id,
          type: "FIAO_SALE",
          amountCents: 80000,
          occurredAt: new Date(Date.now() - 3 * 24 * 3600 * 1000)
        }
      });
    }
  }
}

const LOYALTY_REWARD_ID = "a0000000-0000-4000-8000-000000000001";
const PROMO_PERCENT_ID = "b0000000-0000-4000-8000-000000000001";

async function seedLoyaltyAndPromotions(
  tx: Parameters<Parameters<typeof databaseClient.$transaction>[0]>[0],
  ownerId: string,
  branchId: string
) {
  await tx.loyaltyConfig.upsert({
    where: { ownerId },
    update: { enabled: true, pointsPerHundredCents: 100, expiryDays: 180 },
    create: { ownerId, enabled: true, pointsPerHundredCents: 100, expiryDays: 180 }
  });

  await tx.loyaltyReward.upsert({
    where: { rewardId: LOYALTY_REWARD_ID },
    update: { ownerId, name: "RD$50 de descuento", kind: "FIXED_DISCOUNT", productId: null, discountCents: 5000, pointsCost: 100, active: true },
    create: { rewardId: LOYALTY_REWARD_ID, ownerId, name: "RD$50 de descuento", kind: "FIXED_DISCOUNT", productId: null, discountCents: 5000, pointsCost: 100 }
  });

  // Promo determinística PRODUCT: 10% sobre Habichuelas Rojas 1lb (no toca
  // el Arroz de los tests E2E de venta para no alterar sus totales).
  const habichuelas = await tx.product.findUnique({
    where: { branchId_barcode: { branchId, barcode: "8400000000012" } },
    select: { id: true }
  });
  if (habichuelas) {
    await tx.promotion.upsert({
      where: { id: PROMO_PERCENT_ID },
      update: {
        ownerId,
        name: "10% en Habichuelas",
        kind: "PERCENT_OFF",
        scope: "PRODUCT",
        productId: habichuelas.id,
        percentOffCents: 1000,
        fixedOffCents: null,
        buyQty: null,
        getQty: null,
        active: true,
        startsAt: null,
        endsAt: null
      },
      create: {
        id: PROMO_PERCENT_ID,
        ownerId,
        name: "10% en Habichuelas",
        kind: "PERCENT_OFF",
        scope: "PRODUCT",
        productId: habichuelas.id,
        percentOffCents: 1000,
        fixedOffCents: null,
        buyQty: null,
        getQty: null,
        active: true
      }
    });
  }
}

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
