import type {
  CashClosePayload,
  CashExpensePayload,
  CashInjectionPayload,
  CashOpenPayload,
  CashWithdrawalPayload
} from "@fiao/contracts/cash";
import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient } from "@fiao/database/client";
import { processCashClose } from "@fiao/database/transactions/process-cash-close";
import { processCashOpen } from "@fiao/database/transactions/process-cash-open";
import { processCashMovement } from "@fiao/database/transactions/process-cash-movement";
import { TestFactory } from "@fiao/testkit";
import { resetDatabase } from "@fiao/testkit/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const factory = new TestFactory();

let fixtures: Awaited<ReturnType<TestFactory["ownerWithTwoBranchesAndCashier"]>>;
let ownerDevice: { id: string };
let cashierDevice: { id: string };
let sessionId: string;

function context(role: "OWNER" | "CASHIER" = "OWNER"): CommandContext {
  return {
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    userId: role === "OWNER" ? fixtures.ownerUser.id : fixtures.cashier.id,
    role,
    deviceId: role === "OWNER" ? ownerDevice.id : cashierDevice.id,
    now: new Date()
  };
}

function envelope(
  type: string,
  payload: unknown,
  overrides: Partial<ClientOperationEnvelope> = {},
  actorRole: "OWNER" | "CASHIER" = "OWNER"
): ClientOperationEnvelope {
  const actor = context(actorRole);
  return {
    operationId: crypto.randomUUID(),
    type,
    ownerId: fixtures.owner.id,
    branchId: fixtures.branchA.id,
    actorUserId: actor.userId,
    deviceId: actor.deviceId,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload,
    ...overrides
  };
}

function openPayload(overrides: Partial<CashOpenPayload> = {}): CashOpenPayload {
  return {
    sessionId: sessionId,
    branchId: fixtures.branchA.id,
    openingFloatCents: 2000_00,
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

function expensePayload(overrides: Partial<CashExpensePayload> = {}): CashExpensePayload {
  return {
    movementId: crypto.randomUUID(),
    sessionId,
    amountCents: 500_00,
    category: "Agua",
    description: "Botellón de agua",
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

function withdrawalPayload(overrides: Partial<CashWithdrawalPayload> = {}): CashWithdrawalPayload {
  return {
    movementId: crypto.randomUUID(),
    sessionId,
    amountCents: 300_00,
    reason: "Retiro para compra personal",
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

function injectionPayload(overrides: Partial<CashInjectionPayload> = {}): CashInjectionPayload {
  return {
    movementId: crypto.randomUUID(),
    sessionId,
    amountCents: 500_00,
    reason: "Fondo extra del dueño",
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

function closePayload(overrides: Partial<CashClosePayload> = {}): CashClosePayload {
  return {
    sessionId,
    countedCents: 2000_00,
    occurredAt: new Date().toISOString(),
    ...overrides
  };
}

async function createOwnerAuthorization(purpose: string, operationId: string): Promise<string> {
  const auth = await databaseClient.ownerAuthorization.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      authorizerUserId: fixtures.ownerUser.id,
      purpose,
      targetOperationId: operationId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    }
  });
  return auth.id;
}

/** Inserta una venta cash directo en la sesión abierta (payments CASH). */
async function insertCashSale(amountCents: number, saleId = crypto.randomUUID()): Promise<string> {
  const sale = await databaseClient.sale.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      saleId,
      actorUserId: fixtures.cashier.id,
      deviceId: cashierDevice.id,
      lines: [],
      payments: [{ method: "CASH", amountCents }],
      subtotalCents: amountCents,
      totalCents: amountCents,
      occurredAt: new Date()
    }
  });
  return sale.saleId;
}

/** Inserta un abono cash directo (los abonos se consideran efectivo en V1). */
async function insertAbono(amountCents: number): Promise<void> {
  const customer = await databaseClient.customer.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      customerId: crypto.randomUUID(),
      name: "Cliente Caja"
    }
  });
  await databaseClient.creditMovement.create({
    data: {
      ownerId: fixtures.owner.id,
      branchId: fixtures.branchA.id,
      customerId: customer.id,
      type: "ABONO",
      amountCents,
      abonoId: crypto.randomUUID(),
      occurredAt: new Date()
    }
  });
}

async function openSession(role: "OWNER" | "CASHIER" = "CASHIER") {
  return processCashOpen(context(role), envelope("CASH_OPEN", openPayload(), {}, role));
}

beforeAll(async () => {
  await resetDatabase();
  fixtures = await factory.ownerWithTwoBranchesAndCashier();
  await factory.assignUserToBranch(fixtures.cashier.id, fixtures.branchA.id);
  ownerDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.ownerUser.id, "Celular del dueño");
  cashierDevice = await factory.createDeviceForUser(fixtures.owner.id, fixtures.cashier.id, "POS cajero");
});

beforeEach(async () => {
  sessionId = crypto.randomUUID();
  // Orden respetando FK Restrict hacia clientOperation.
  await databaseClient.cashMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.cashSession.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.syncChange.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.creditMovement.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.sale.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.customer.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.auditEvent.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.clientOperation.deleteMany({ where: { branchId: fixtures.branchA.id } });
  await databaseClient.ownerAuthorization.deleteMany({ where: { branchId: fixtures.branchA.id } });
});

describe("processCashOpen", () => {
  it("opens a session as CASHIER with the opening float", async () => {
    const result = await openSession("CASHIER");

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.status).toBe("OPEN");
    expect(session.openingFloatCents).toBe(2000_00);
    expect(session.openedById).toBe(fixtures.cashier.id);
  });

  it("rejects a second open while a session is already open", async () => {
    await openSession("CASHIER");
    const second = await processCashOpen(
      context("CASHIER"),
      envelope("CASH_OPEN", openPayload({ sessionId: crypto.randomUUID() }), {}, "CASHIER")
    );

    expect(second.status).toBe("REJECTED");
    expect(second.errorCode).toBe("CASH_SESSION_ALREADY_OPEN");
  });

  it("is idempotent on retry", async () => {
    const firstEnvelope = envelope("CASH_OPEN", openPayload(), {}, "CASHIER");
    const first = await processCashOpen(context("CASHIER"), firstEnvelope);
    const retry = await processCashOpen(context("CASHIER"), firstEnvelope);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    const sessions = await databaseClient.cashSession.count({ where: { branchId: fixtures.branchA.id } });
    expect(sessions).toBe(1);
  });

  it("rejects an unknown branch", async () => {
    const result = await processCashOpen(
      context(),
      envelope("CASH_OPEN", openPayload({ branchId: crypto.randomUUID() }))
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("UNKNOWN_BRANCH");
  });
});

describe("processCashMovement", () => {
  it("accepts an EXPENSE within the cashier limit", async () => {
    await openSession("CASHIER");
    const result = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_EXPENSE", expensePayload(), {}, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    const movement = await databaseClient.cashMovement.findFirstOrThrow({
      where: { session: { sessionId } }
    });
    expect(movement.type).toBe("EXPENSE");
    expect(movement.amountCents).toBe(500_00);
  });

  it("rejects an EXPENSE above the limit without owner authorization", async () => {
    await openSession("CASHIER");
    const result = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_EXPENSE", expensePayload({ amountCents: 150_000 }), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("accepts an EXPENSE above the limit with owner authorization", async () => {
    await openSession("CASHIER");
    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("CASH_EXPENSE", operationId);
    const result = await processCashMovement(
      context("CASHIER"),
      envelope(
        "CASH_EXPENSE",
        expensePayload({ amountCents: 150_000, ownerAuthorizationId: authId }),
        { operationId },
        "CASHIER"
      )
    );

    expect(result.status).toBe("ACCEPTED");
  });

  it("rejects a WITHDRAWAL without owner authorization and accepts with it", async () => {
    await openSession("CASHIER");
    const rejected = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_WITHDRAWAL", withdrawalPayload(), {}, "CASHIER")
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");

    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("CASH_WITHDRAWAL", operationId);
    const accepted = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_WITHDRAWAL", withdrawalPayload({ ownerAuthorizationId: authId }), { operationId }, "CASHIER")
    );
    expect(accepted.status).toBe("ACCEPTED");
  });

  it("accepts an INJECTION with owner authorization", async () => {
    await openSession("CASHIER");
    const operationId = crypto.randomUUID();
    const authId = await createOwnerAuthorization("CASH_INJECTION", operationId);
    const result = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_INJECTION", injectionPayload({ ownerAuthorizationId: authId }), { operationId }, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    const movement = await databaseClient.cashMovement.findFirstOrThrow({
      where: { session: { sessionId } }
    });
    expect(movement.type).toBe("INJECTION");
  });

  it("rejects a movement when no session is open", async () => {
    const result = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_EXPENSE", expensePayload(), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("CASH_SESSION_REQUIRED");
  });

  it("rejects a movement on a closed session", async () => {
    await openSession("CASHIER");
    await processCashClose(context("CASHIER"), envelope("CASH_CLOSE", closePayload(), {}, "CASHIER"));

    const result = await processCashMovement(
      context("CASHIER"),
      envelope("CASH_EXPENSE", expensePayload(), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("CASH_SESSION_CLOSED");
  });

  it("is idempotent on retry", async () => {
    await openSession("CASHIER");
    const firstEnvelope = envelope("CASH_EXPENSE", expensePayload(), {}, "CASHIER");
    const first = await processCashMovement(context("CASHIER"), firstEnvelope);
    const retry = await processCashMovement(context("CASHIER"), firstEnvelope);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    const movements = await databaseClient.cashMovement.count({
      where: { session: { sessionId } }
    });
    expect(movements).toBe(1);
  });
});

describe("processCashClose", () => {
  it("closes a session that reconciles (difference 0) as CASHIER", async () => {
    await openSession("CASHIER");
    const result = await processCashClose(context("CASHIER"), envelope("CASH_CLOSE", closePayload(), {}, "CASHIER"));

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.status).toBe("CLOSED");
    expect(session.countedCents).toBe(2000_00);
    expect(session.differenceCents).toBe(0);
    const differences = await databaseClient.cashMovement.count({
      where: { session: { sessionId }, type: "DIFFERENCE" }
    });
    expect(differences).toBe(0);
  });

  it("computes expected = float + cash sales − expenses (spec §10.5)", async () => {
    await openSession("CASHIER");
    await insertCashSale(1500_00);
    await processCashMovement(
      context("CASHIER"),
      envelope("CASH_EXPENSE", expensePayload(), {}, "CASHIER")
    );
    // expected = 2000 + 1500 − 500 = 3000
    const result = await processCashClose(
      context("CASHIER"),
      envelope("CASH_CLOSE", closePayload({ countedCents: 3000_00 }), {}, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.differenceCents).toBe(0);
  });

  it("ignores reversed (annulled) cash sales in the expected", async () => {
    await openSession("CASHIER");
    const saleId = await insertCashSale(1500_00);
    await databaseClient.syncChange.create({
      data: {
        ownerId: fixtures.owner.id,
        branchId: fixtures.branchA.id,
        type: "REVERSAL",
        payload: { reversalId: crypto.randomUUID(), saleId, lines: [], reason: "Devolución", occurredAt: new Date().toISOString() }
      }
    });
    // expected = 2000 (la venta anulada no cuenta)
    const result = await processCashClose(
      context("CASHIER"),
      envelope("CASH_CLOSE", closePayload({ countedCents: 2000_00 }), {}, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.differenceCents).toBe(0);
  });

  it("counts cash abonos in the expected (V1: abonos son efectivo)", async () => {
    await openSession("CASHIER");
    await insertAbono(800_00);
    // expected = 2000 + 800 = 2800
    const result = await processCashClose(
      context("CASHIER"),
      envelope("CASH_CLOSE", closePayload({ countedCents: 2800_00 }), {}, "CASHIER")
    );

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.differenceCents).toBe(0);
  });

  it("rejects a CASHIER closing with difference without authorization", async () => {
    await openSession("CASHIER");
    const result = await processCashClose(
      context("CASHIER"),
      envelope("CASH_CLOSE", closePayload({ countedCents: 1900_00 }), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("OWNER_AUTHORIZATION_REQUIRED");
  });

  it("accepts an OWNER closing with difference and records a DIFFERENCE movement", async () => {
    await openSession("CASHIER");
    const result = await processCashClose(
      context("OWNER"),
      envelope("CASH_CLOSE", closePayload({ countedCents: 1900_00 }))
    );

    expect(result.status).toBe("ACCEPTED");
    const session = await databaseClient.cashSession.findUniqueOrThrow({ where: { sessionId } });
    expect(session.status).toBe("CLOSED");
    expect(session.differenceCents).toBe(-100_00);
    const difference = await databaseClient.cashMovement.findFirstOrThrow({
      where: { session: { sessionId }, type: "DIFFERENCE" }
    });
    expect(difference.amountCents).toBe(-100_00);
  });

  it("rejects closing a session that is already closed", async () => {
    await openSession("CASHIER");
    await processCashClose(context("CASHIER"), envelope("CASH_CLOSE", closePayload(), {}, "CASHIER"));
    const result = await processCashClose(
      context("CASHIER"),
      envelope("CASH_CLOSE", closePayload(), {}, "CASHIER")
    );

    expect(result.status).toBe("REJECTED");
    expect(result.errorCode).toBe("CASH_SESSION_CLOSED");
  });

  it("is idempotent on retry", async () => {
    await openSession("CASHIER");
    const firstEnvelope = envelope("CASH_CLOSE", closePayload(), {}, "CASHIER");
    const first = await processCashClose(context("CASHIER"), firstEnvelope);
    const retry = await processCashClose(context("CASHIER"), firstEnvelope);

    expect(first.status).toBe("ACCEPTED");
    expect(retry.status).toBe("ACCEPTED");
    const sessions = await databaseClient.cashSession.count({ where: { branchId: fixtures.branchA.id } });
    expect(sessions).toBe(1);
  });
});
