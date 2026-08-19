import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { resetDatabase } from "@fiao/testkit/db";
import { TestFactory } from "@fiao/testkit/factories";
import { beforeEach, describe, expect, it } from "vitest";
import { AiOrchestrator } from "./orchestrator";

const factory = new TestFactory();

interface Tenant {
  owner: { id: string };
  branchA: { id: string };
  ownerUser: { id: string };
  cashier: { id: string };
}

function context(role: "OWNER" | "CASHIER", tenant: Tenant, deviceId: string): CommandContext {
  return {
    ownerId: tenant.owner.id,
    branchId: tenant.branchA.id,
    userId: role === "OWNER" ? tenant.ownerUser.id : tenant.cashier.id,
    role,
    deviceId,
    now: new Date()
  };
}

async function createCustomer(tenant: Tenant, name: string, phoneE164: string): Promise<{ id: string }> {
  return databaseClient.customer.create({
    data: {
      ownerId: tenant.owner.id,
      branchId: tenant.branchA.id,
      customerId: crypto.randomUUID(),
      name,
      phoneE164,
      creditLimitCents: 100000
    }
  });
}

async function addFiaoCharge(tenant: Tenant, customerId: string, amountCents: number): Promise<void> {
  await databaseClient.creditMovement.create({
    data: {
      ownerId: tenant.owner.id,
      branchId: tenant.branchA.id,
      customerId,
      type: "FIAO_SALE",
      amountCents,
      occurredAt: new Date()
    }
  });
}

describe("AiOrchestrator (integración)", () => {
  beforeEach(async () => resetDatabase());

  it("responde consulta de ventas de solo lectura", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id);
    const orchestrator = new AiOrchestrator();

    const turn = await orchestrator.handleMessage("¿cuánto vendí hoy?", context("OWNER", tenant, device.id));

    expect(turn.kind).toBe("query");
    if (turn.kind === "query") {
      expect(turn.label).toBe("CONFIRMED");
      expect(turn.text).toContain("Ventas de hoy");
    }
  });

  it("resuelve el saldo de un cliente por nombre", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id);
    const customer = await createCustomer(tenant, "Doña María Peña", "+18095550001");
    await addFiaoCharge(tenant, customer.id, 80000);
    const orchestrator = new AiOrchestrator();

    const turn = await orchestrator.handleMessage("cuánto me debe maría", context("OWNER", tenant, device.id));

    expect(turn.kind).toBe("query");
    if (turn.kind === "query") {
      expect(turn.text).toContain("RD$800.00");
    }
  });

  it("nunca auto-resuelve nombres ambiguos", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id);
    await createCustomer(tenant, "María Peña", "+18095550001");
    await createCustomer(tenant, "María Rodríguez", "+18095550002");
    const orchestrator = new AiOrchestrator();

    const turn = await orchestrator.handleMessage("cuánto me debe maría", context("OWNER", tenant, device.id));

    expect(turn.kind).toBe("clarification");
    if (turn.kind === "clarification") {
      expect(turn.ambiguities.length).toBe(2);
    }
  });

  it("prepara y confirma un abono con confirmación humana", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id);
    const customer = await createCustomer(tenant, "Rafael Marte", "+18095550002");
    await addFiaoCharge(tenant, customer.id, 80000);
    const orchestrator = new AiOrchestrator();

    const preview = await orchestrator.handleMessage("abona 500 pesos a rafael", context("OWNER", tenant, device.id));
    expect(preview.kind).toBe("action_preview");
    if (preview.kind !== "action_preview") return;
    expect(preview.requiresOwnerPin).toBe(false);

    const result = await orchestrator.confirmAction(preview.token, context("OWNER", tenant, device.id), null);
    expect(result.kind).toBe("action_result");
    if (result.kind === "action_result") {
      expect(result.ok).toBe(true);
    }

    const movements = await databaseClient.creditMovement.findMany({ where: { customerId: customer.id }, select: { type: true, amountCents: true } });
    const computed = movements.reduce((acc, movement) => (movement.type === "FIAO_SALE" ? acc + movement.amountCents : acc - movement.amountCents), 0);
    expect(computed).toBe(30000);
  });

  it("acción protegida requiere PIN para el cajero", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const cashierDevice = await factory.createDeviceForUser(tenant.owner.id, tenant.cashier.id);
    const product = await factory.createProduct({ ownerId: tenant.owner.id, id: tenant.branchA.id }, { name: "Arroz", onHand: "10" });
    const orchestrator = new AiOrchestrator();

    const preview = await orchestrator.handleMessage(
      "ajusta el inventario",
      context("CASHIER", tenant, cashierDevice.id),
      { productId: product.id, quantityDelta: "-2", reason: "merma" }
    );
    expect(preview.kind).toBe("action_preview");
    if (preview.kind !== "action_preview") return;
    expect(preview.requiresOwnerPin).toBe(true);

    // Sin PIN → rechazada.
    const denied = await orchestrator.confirmAction(preview.token, context("CASHIER", tenant, cashierDevice.id), null);
    expect(denied.kind).toBe("action_result");
    if (denied.kind === "action_result") expect(denied.ok).toBe(false);

    // Con autorización del dueño ligada al operationId → aceptada.
    const authorization = await databaseClient.ownerAuthorization.create({
      data: {
        ownerId: tenant.owner.id,
        branchId: tenant.branchA.id,
        authorizerUserId: tenant.ownerUser.id,
        purpose: "STOCK_ADJUSTMENT",
        targetOperationId: preview.operationId,
        expiresAt: new Date(Date.now() + 5 * 60_000)
      }
    });
    const accepted = await orchestrator.confirmAction(preview.token, context("CASHIER", tenant, cashierDevice.id), authorization.id);
    expect(accepted.kind).toBe("action_result");
    if (accepted.kind === "action_result") expect(accepted.ok).toBe(true);

    const stock = await databaseClient.productStock.findUnique({ where: { productId: product.id } });
    expect(stock?.onHand).toBe("8");
  });

  it("replay del mismo token no duplica (idempotencia)", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.ownerUser.id);
    const customer = await createCustomer(tenant, "Yenny Rosario", "+18095550003");
    await addFiaoCharge(tenant, customer.id, 80000);
    const orchestrator = new AiOrchestrator();

    const preview = await orchestrator.handleMessage("abona 100 pesos a yenny", context("OWNER", tenant, device.id));
    expect(preview.kind).toBe("action_preview");
    if (preview.kind !== "action_preview") return;

    const first = await orchestrator.confirmAction(preview.token, context("OWNER", tenant, device.id), null);
    if (first.kind === "action_result") expect(first.ok).toBe(true);

    const second = await orchestrator.confirmAction(preview.token, context("OWNER", tenant, device.id), null);
    expect(second.kind).toBe("action_result");
    if (second.kind === "action_result") {
      expect(second.ok).toBe(false);
      expect(second.message).toContain("ya fue ejecutada");
    }
  });

  it("no expone datos owner-only (margen/diferencia) al cajero", async () => {
    const tenant = await factory.ownerWithTwoBranchesAndCashier();
    const device = await factory.createDeviceForUser(tenant.owner.id, tenant.cashier.id);
    const orchestrator = new AiOrchestrator();

    const turn = await orchestrator.handleMessage("¿cuánto hay en caja?", context("CASHIER", tenant, device.id));
    expect(turn.kind).toBe("query");
    if (turn.kind === "query") {
      const data = turn.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("differenceCents");
      expect(data).not.toHaveProperty("countedCents");
      expect(data).not.toHaveProperty("marginCents");
    }
  });
});
