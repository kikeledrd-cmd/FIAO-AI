import { randomUUID } from "node:crypto";
import type { AiEntityOption, AiQueryToolName, AiActionToolName } from "@fiao/contracts/ai";
import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { databaseClient, type FiaoPrismaClient } from "../client";
import { AiQueryRepository } from "../repositories/ai-repository";
import { processOperation } from "../transactions/process-operation";

export type AiLabel = "CONFIRMED" | "ESTIMATED" | "RECOMMENDATION";

export interface AiQueryResult {
  label: AiLabel;
  data?: unknown;
  warnings: string[];
  ambiguities?: AiEntityOption[];
}

export interface AiActionPlan {
  operationType: string;
  operationId: string;
  payload: Record<string, unknown>;
  summary: string;
  amountCents: number | null;
  requiresOwnerPin: boolean;
}

export type AiActionPlanResult =
  | { status: "ok"; plan: AiActionPlan }
  | { status: "clarification"; message: string; ambiguities: AiEntityOption[] }
  | { status: "unsupported"; message: string };

export interface AiActionParams {
  amountCents?: number | null;
  customerQuery?: string | null;
  customerId?: string | null;
  productId?: string | null;
  quantityDelta?: string | null;
  reason?: string | null;
  /** Ventas: productos y cantidades textuales (no soportado por voz en V1). */
  text?: string | null;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** Ejecuta una consulta de solo lectura y devuelve datos estructurados. */
export async function runAiQuery(
  tool: AiQueryToolName,
  params: AiActionParams,
  context: CommandContext,
  db: FiaoPrismaClient = databaseClient
): Promise<AiQueryResult> {
  const repo = new AiQueryRepository(db);
  switch (tool) {
    case "SALES_SUMMARY": {
      const summary = await repo.salesSummary(context.ownerId, context.branchId, startOfToday());
      return {
        label: "CONFIRMED",
        data: summary,
        warnings: []
      };
    }
    case "CREDIT_SUMMARY": {
      const summary = await repo.creditSummary(context.ownerId, context.branchId);
      return {
        label: "CONFIRMED",
        data: summary,
        warnings: summary.totalFiadoCents > 0 ? [] : ["No hay fiado pendiente en esta sucursal."]
      };
    }
    case "CUSTOMER_BALANCE": {
      const repo = new AiQueryRepository(db);
      const { customerId, ambiguities } = await resolveCustomer(db, context, params);
      if (!customerId) {
        return { label: "CONFIRMED", warnings: [], ...(ambiguities.length > 0 ? { ambiguities } : {}) };
      }
      const balance = await repo.customerBalance(context.ownerId, context.branchId, customerId);
      return { label: "CONFIRMED", data: { balanceCents: balance, customerId }, warnings: [] };
    }
    case "INVENTORY_STATUS": {
      const items = await repo.inventoryStatus(context.ownerId, context.branchId);
      const low = items.filter((item) => item.low);
      return {
        label: "CONFIRMED",
        data: { lowItems: low },
        warnings: low.length === 0 ? ["No hay productos con stock bajo."] : []
      };
    }
    case "CASH_STATUS": {
      const status = await repo.cashStatus(context.ownerId, context.branchId);
      return {
        label: "CONFIRMED",
        data: status,
        warnings: status.openSessionId ? [] : ["No hay caja abierta en esta sucursal."]
      };
    }
    case "ORDERS_STATUS": {
      const status = await repo.ordersStatus(context.ownerId, context.branchId);
      return {
        label: "CONFIRMED",
        data: status,
        warnings: status.total === 0 ? ["No hay pedidos activos."] : []
      };
    }
    default:
      return { label: "CONFIRMED", warnings: ["Consulta no reconocida."] };
  }
}

/** Resuelve un cliente por nombre (o id explícito); devuelve ambigüedad si hay varios. */
async function resolveCustomer(
  db: FiaoPrismaClient,
  context: CommandContext,
  params: AiActionParams
): Promise<{ customerId: string | null; ambiguities: AiEntityOption[] }> {
  if (params.customerId) return { customerId: params.customerId, ambiguities: [] };
  if (!params.customerQuery) return { customerId: null, ambiguities: [] };
  const matches = await new AiQueryRepository(db).findCustomers(
    context.ownerId,
    context.branchId,
    params.customerQuery
  );
  if (matches.length === 1) {
    const match = matches[0];
    if (!match) return { customerId: null, ambiguities: [] };
    return { customerId: match.customerId, ambiguities: [] };
  }
  if (matches.length > 1) {
    return {
      customerId: null,
      ambiguities: matches.map((match) => ({
        key: "customer",
        id: match.customerId,
        label: match.name,
        ...(match.phoneE164 ? { hint: match.phoneE164 } : {})
      }))
    };
  }
  return { customerId: null, ambiguities: [] };
}

/** Construye el plan de una acción (ids estables para idempotencia/replay). */
export async function buildActionPlan(
  tool: AiActionToolName,
  params: AiActionParams,
  context: CommandContext,
  db: FiaoPrismaClient = databaseClient
): Promise<AiActionPlanResult> {
  switch (tool) {
    case "REGISTER_ABONO": {
      if (!params.amountCents) {
        return { status: "clarification", message: "¿De cuánto es el abono?", ambiguities: [] };
      }
      const { customerId, ambiguities } = await resolveCustomer(db, context, params);
      if (!customerId) {
        if (ambiguities.length > 0) {
          return { status: "clarification", message: "Hay varios clientes con ese nombre.", ambiguities };
        }
        return { status: "clarification", message: "No encontré ese cliente en esta sucursal.", ambiguities: [] };
      }
      const abonoId = randomUUID();
      const payload = {
        abonoId,
        customerId,
        amountCents: params.amountCents,
        occurredAt: new Date().toISOString()
      };
      return {
        status: "ok",
        plan: {
          operationType: "ABONO",
          operationId: abonoId,
          payload,
          summary: `Abonar ${params.amountCents} centavos al cliente seleccionado.`,
          amountCents: params.amountCents,
          requiresOwnerPin: false
        }
      };
    }
    case "OPEN_CASH": {
      const openingFloatCents = params.amountCents ?? 0;
      const sessionId = randomUUID();
      const payload = {
        sessionId,
        branchId: context.branchId,
        openingFloatCents,
        occurredAt: new Date().toISOString()
      };
      return {
        status: "ok",
        plan: {
          operationType: "CASH_OPEN",
          operationId: sessionId,
          payload,
          summary: `Abrir caja con un fondo de ${openingFloatCents} centavos.`,
          amountCents: openingFloatCents,
          requiresOwnerPin: false
        }
      };
    }
    case "STOCK_ADJUSTMENT": {
      if (!params.productId || !params.quantityDelta || !params.reason) {
        return {
          status: "clarification",
          message: "Necesito el producto, la cantidad y el motivo del ajuste.",
          ambiguities: []
        };
      }
      const adjustmentId = randomUUID();
      const payload = {
        adjustmentId,
        productId: params.productId,
        quantityDelta: params.quantityDelta,
        reason: params.reason
      };
      return {
        status: "ok",
        plan: {
          operationType: "STOCK_ADJUSTMENT",
          operationId: adjustmentId,
          payload,
          summary: `Ajustar inventario: ${params.quantityDelta} del producto seleccionado (${params.reason}).`,
          amountCents: null,
          requiresOwnerPin: true
        }
      };
    }
    case "CREATE_SALE":
    case "CREATE_ORDER":
      return {
        status: "unsupported",
        message: "Esa acción se hace mejor desde la pantalla de Vender o Pedidos. Por voz solo manejo consultas, abonos, apertura de caja y ajustes de inventario."
      };
    default:
      return { status: "unsupported", message: "Acción no reconocida." };
  }
}

/** Ejecuta un plan de acción pasando por el dispatcher de operaciones. */
export async function executeActionPlan(
  plan: AiActionPlan,
  context: CommandContext,
  db: FiaoPrismaClient = databaseClient
): Promise<OperationResult> {
  const envelope: ClientOperationEnvelope = {
    operationId: plan.operationId,
    type: plan.operationType,
    ownerId: context.ownerId,
    branchId: context.branchId,
    actorUserId: context.userId,
    deviceId: context.deviceId,
    occurredAt: new Date().toISOString(),
    baseCursor: null,
    payload: plan.payload
  };
  return processOperation(context, envelope, db);
}
