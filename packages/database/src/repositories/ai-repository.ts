import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { computeExpectedCashForSession, type CashSessionRow } from "../transactions/cash-shared";

export interface SalesSummary {
  totalSalesCents: number;
  salesCount: number;
  cashCents: number;
  transferCents: number;
  fiadoCents: number;
}

export interface CreditSummary {
  totalFiadoCents: number;
  customersWithDebt: number;
}

export interface InventoryStatusItem {
  productId: string;
  name: string;
  onHand: string;
  reserved: string;
  available: number;
  low: boolean;
}

export interface CashStatus {
  openSessionId: string | null;
  openingFloatCents: number | null;
  expectedCents: number | null;
}

export interface OrdersStatus {
  total: number;
  byStatus: Record<string, number>;
}

export interface CustomerMatch {
  id: string;
  customerId: string;
  name: string;
  phoneE164: string | null;
}

export interface AiAuditLogInput {
  ownerId: string;
  branchId: string;
  actorUserId: string;
  actorRole: "OWNER" | "CASHIER";
  commandText: string;
  transcription: string | null;
  intentKind: "QUERY" | "ACTION";
  intentTool: string;
  label: string | null;
  confirmationToken: string | null;
  authorizationId: string | null;
  resultJson: string | null;
}

export interface AiActionTokenRow {
  id: string;
  tokenId: string;
  ownerId: string;
  branchId: string;
  actorUserId: string;
  intentTool: string;
  payload: Prisma.JsonValue;
  requiresOwnerPin: boolean;
  consumedAt: Date | null;
  expiresAt: Date;
}

function cashCentsOf(payments: unknown): number {
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, payment) => {
    if (typeof payment !== "object" || payment === null) return sum;
    const candidate = payment as { method?: unknown; amountCents?: unknown };
    if (candidate.method === "CASH" && typeof candidate.amountCents === "number") {
      return sum + candidate.amountCents;
    }
    return sum;
  }, 0);
}

/** Normaliza para búsqueda tolerante a acentos y mayúsculas. */
function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Consultas de solo lectura para FIAO AI (agregaciones por sucursal). */
export class AiQueryRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async salesSummary(ownerId: string, branchId: string, since: Date): Promise<SalesSummary> {
    const sales = await this.db.sale.findMany({
      where: { ownerId, branchId, occurredAt: { gte: since } },
      select: { totalCents: true, payments: true }
    });
    let totalSalesCents = 0;
    let cashCents = 0;
    let transferCents = 0;
    let fiadoCents = 0;
    for (const sale of sales) {
      totalSalesCents += sale.totalCents;
      const payments = sale.payments as Array<{ method?: string; amountCents?: number }>;
      for (const payment of payments) {
        if (payment.method === "CASH") cashCents += payment.amountCents ?? 0;
        else if (payment.method === "TRANSFER") transferCents += payment.amountCents ?? 0;
        else if (payment.method === "FIADO") fiadoCents += payment.amountCents ?? 0;
      }
    }
    return { totalSalesCents, salesCount: sales.length, cashCents, transferCents, fiadoCents };
  }

  async creditSummary(ownerId: string, branchId: string): Promise<CreditSummary> {
    const movements = await this.db.creditMovement.findMany({
      where: { ownerId, branchId },
      select: { customerId: true, type: true, amountCents: true }
    });
    const balanceByCustomer = new Map<string, number>();
    for (const movement of movements) {
      const current = balanceByCustomer.get(movement.customerId) ?? 0;
      const next = movement.type === "FIAO_SALE" ? current + movement.amountCents : current - movement.amountCents;
      balanceByCustomer.set(movement.customerId, next);
    }
    let totalFiadoCents = 0;
    let customersWithDebt = 0;
    for (const balance of balanceByCustomer.values()) {
      if (balance > 0) {
        totalFiadoCents += balance;
        customersWithDebt += 1;
      }
    }
    return { totalFiadoCents, customersWithDebt };
  }

  async customerBalance(ownerId: string, branchId: string, customerPublicId: string): Promise<number> {
    const customer = await this.db.customer.findUnique({
      where: { customerId: customerPublicId },
      select: { id: true }
    });
    if (!customer) return 0;
    const movements = await this.db.creditMovement.findMany({
      where: { ownerId, branchId, customerId: customer.id },
      select: { type: true, amountCents: true }
    });
    return movements.reduce(
      (acc, movement) => (movement.type === "FIAO_SALE" ? acc + movement.amountCents : acc - movement.amountCents),
      0
    );
  }

  async inventoryStatus(ownerId: string, branchId: string): Promise<InventoryStatusItem[]> {
    const rows = await this.db.product.findMany({
      where: { ownerId, branchId, active: true, stockControl: true },
      select: {
        id: true,
        name: true,
        stock: { select: { onHand: true, reserved: true } }
      }
    });
    return rows.map((row) => {
      const onHand = Number(row.stock?.onHand ?? "0");
      const reserved = Number(row.stock?.reserved ?? "0");
      const available = onHand - reserved;
      return {
        productId: row.id,
        name: row.name,
        onHand: row.stock?.onHand ?? "0",
        reserved: row.stock?.reserved ?? "0",
        available,
        low: available <= 3
      };
    });
  }

  async cashStatus(ownerId: string, branchId: string): Promise<CashStatus> {
    const session = await this.db.cashSession.findFirst({
      where: { ownerId, branchId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      select: { id: true, status: true, openingFloatCents: true }
    });
    if (!session) return { openSessionId: null, openingFloatCents: null, expectedCents: null };
    const expectedCents = await computeExpectedCashForSession(
      this.db,
      { ownerId, branchId, userId: "", role: "OWNER", deviceId: "", now: new Date() },
      session as CashSessionRow
    );
    return { openSessionId: session.id, openingFloatCents: session.openingFloatCents, expectedCents };
  }

  async ordersStatus(ownerId: string, branchId: string): Promise<OrdersStatus> {
    const orders = await this.db.order.findMany({
      where: { ownerId, branchId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { status: true }
    });
    const byStatus: Record<string, number> = {};
    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
    }
    return { total: orders.length, byStatus };
  }

  async findCustomers(ownerId: string, branchId: string, query: string): Promise<CustomerMatch[]> {
    const normalizedQuery = normalizeSearch(query);
    const rows = await this.db.customer.findMany({
      where: { ownerId, branchId, active: true },
      select: { id: true, customerId: true, name: true, phoneE164: true },
      orderBy: { name: "asc" }
    });
    return rows.filter((row) => normalizeSearch(row.name).includes(normalizedQuery)).slice(0, 5);
  }
}

/** Append-only para FIAO AI: audit log + tokens de confirmación de acciones. */
export class AiAuditRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async log(input: AiAuditLogInput): Promise<void> {
    await this.db.aiAuditLog.create({ data: input });
  }

  async createActionToken(
    ownerId: string,
    branchId: string,
    actorUserId: string,
    intentTool: string,
    payload: unknown,
    requiresOwnerPin: boolean,
    expiresAt: Date
  ): Promise<AiActionTokenRow> {
    const row = await this.db.aiActionToken.create({
      data: {
        tokenId: randomUUID(),
        ownerId,
        branchId,
        actorUserId,
        intentTool,
        payload: payload as Prisma.InputJsonValue,
        requiresOwnerPin,
        expiresAt
      }
    });
    return {
      id: row.id,
      tokenId: row.tokenId,
      ownerId: row.ownerId,
      branchId: row.branchId,
      actorUserId: row.actorUserId,
      intentTool: row.intentTool,
      payload: row.payload,
      requiresOwnerPin: row.requiresOwnerPin,
      consumedAt: row.consumedAt,
      expiresAt: row.expiresAt
    };
  }

  async findActionToken(tokenId: string): Promise<AiActionTokenRow | null> {
    const row = await this.db.aiActionToken.findUnique({ where: { tokenId } });
    if (!row) return null;
    return {
      id: row.id,
      tokenId: row.tokenId,
      ownerId: row.ownerId,
      branchId: row.branchId,
      actorUserId: row.actorUserId,
      intentTool: row.intentTool,
      payload: row.payload,
      requiresOwnerPin: row.requiresOwnerPin,
      consumedAt: row.consumedAt,
      expiresAt: row.expiresAt
    };
  }

  async consumeActionToken(tokenId: string): Promise<void> {
    await this.db.aiActionToken.update({
      where: { tokenId },
      data: { consumedAt: new Date() }
    });
  }
}
