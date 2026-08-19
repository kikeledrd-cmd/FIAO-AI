import type { AiEntityOption, AiActionToolName, AiQueryToolName, AiToolName } from "@fiao/contracts/ai";
import type { CommandContext } from "@fiao/domain/context";
import {
  isAiActionTool,
  isAiQueryTool,
  isProtectedAiTool
} from "@fiao/domain/ai/ai-intent";
import {
  AiAuditRepository,
  buildActionPlan,
  executeActionPlan,
  runAiQuery,
  type AiActionParams,
  type AiActionPlan
} from "@fiao/database";
import { defaultAiProvider, type AiProvider } from "./provider";

export type AiTurn =
  | {
      kind: "query";
      intentTool: AiToolName;
      label: "CONFIRMED" | "ESTIMATED" | "RECOMMENDATION";
      text: string;
      data?: unknown;
      warnings: string[];
    }
  | {
      kind: "clarification";
      intentTool: AiToolName;
      message: string;
      ambiguities: AiEntityOption[];
    }
  | {
      kind: "action_preview";
      token: string;
      operationId: string;
      intentTool: AiToolName;
      summary: string;
      amountCents: number | null;
      requiresOwnerPin: boolean;
      warnings: string[];
      ambiguities: AiEntityOption[];
      expiresAt: string;
    }
  | {
      kind: "action_result";
      intentTool: AiToolName;
      ok: boolean;
      operationId: string | null;
      message: string;
    };

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const pesos = Math.floor(absolute / 100);
  const centavos = String(absolute % 100).padStart(2, "0");
  return `${sign}RD$${pesos.toLocaleString("es-DO")}.${centavos}`;
}

function buildQueryText(tool: AiToolName, data: unknown, warnings: string[]): string {
  switch (tool) {
    case "SALES_SUMMARY": {
      const summary = data as { totalSalesCents: number; salesCount: number };
      return `Ventas de hoy: ${formatCents(summary.totalSalesCents)} en ${summary.salesCount} venta(s).`;
    }
    case "CREDIT_SUMMARY": {
      const summary = data as { totalFiadoCents: number; customersWithDebt: number };
      return `Fiado pendiente: ${formatCents(summary.totalFiadoCents)} entre ${summary.customersWithDebt} cliente(s).`;
    }
    case "CUSTOMER_BALANCE": {
      const result = data as { balanceCents: number } | null;
      if (!result) return "No pude determinar el saldo de ese cliente.";
      return `El saldo es ${formatCents(result.balanceCents)}.`;
    }
    case "INVENTORY_STATUS": {
      const result = data as { lowItems: Array<{ name: string; available: number }> };
      if (result.lowItems.length === 0) return "No hay productos con stock bajo.";
      const names = result.lowItems.map((item) => `${item.name} (${item.available})`).join(", ");
      return `Productos con stock bajo: ${names}.`;
    }
    case "CASH_STATUS": {
      const result = data as { openSessionId: string | null; openingFloatCents: number | null; expectedCents: number | null };
      if (!result.openSessionId) return "No hay caja abierta en esta sucursal.";
      const expected = result.expectedCents !== null ? formatCents(result.expectedCents) : "—";
      return `Caja abierta. Fondo inicial ${formatCents(result.openingFloatCents ?? 0)}; efectivo esperado ${expected}.`;
    }
    case "ORDERS_STATUS": {
      const result = data as { total: number; byStatus: Record<string, number> };
      if (result.total === 0) return "No hay pedidos activos.";
      return `Hay ${result.total} pedido(s) activo(s).`;
    }
    default:
      return warnings.join(" ") || "Consulta procesada.";
  }
}

export interface AiOrchestratorDeps {
  provider?: AiProvider;
  audit?: AiAuditRepository;
}

/**
 * Orquestador de FIAO AI. Garantiza que el modelo (provider) solo produce
 * intents; toda consulta pasa por repos de solo lectura y toda acción pasa por
 * command handlers con confirmación. Registra cada interacción en el audit log.
 */
export class AiOrchestrator {
  private readonly provider: AiProvider;
  private readonly audit: AiAuditRepository;

  constructor(deps: AiOrchestratorDeps = {}) {
    this.provider = deps.provider ?? defaultAiProvider();
    this.audit = deps.audit ?? new AiAuditRepository();
  }

  async handleMessage(text: string, context: CommandContext, overrides: AiActionParams = {}): Promise<AiTurn> {
    const intent = this.provider.parseIntent(text);
    const params: AiActionParams = { ...intent.parameters };
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== null && value !== undefined) {
        (params as Record<string, unknown>)[key] = value;
      }
    }
    const isQuery = isAiQueryTool(intent.tool);
    const isAction = isAiActionTool(intent.tool);

    if (isQuery) {
      const result = await runAiQuery(intent.tool as AiQueryToolName, params, context);
      if (result.ambiguities && result.ambiguities.length > 0) {
        return {
          kind: "clarification",
          intentTool: intent.tool,
          message: "Hay varios clientes con ese nombre. Selecciona uno o escribe el nombre completo.",
          ambiguities: result.ambiguities
        };
      }
      const queryText = buildQueryText(intent.tool, result.data, result.warnings);
      await this.audit.log({
        ownerId: context.ownerId,
        branchId: context.branchId,
        actorUserId: context.userId,
        actorRole: context.role,
        commandText: text,
        transcription: null,
        intentKind: "QUERY",
        intentTool: intent.tool,
        label: result.label,
        confirmationToken: null,
        authorizationId: null,
        resultJson: JSON.stringify(result.data ?? null)
      });
      return {
        kind: "query",
        intentTool: intent.tool,
        label: result.label,
        text: queryText,
        ...(result.data !== undefined ? { data: result.data } : {}),
        warnings: result.warnings
      };
    }

    if (isAction) {
      const plan = await buildActionPlan(intent.tool as AiActionToolName, params, context);
      if (plan.status === "unsupported") {
        return {
          kind: "query",
          intentTool: intent.tool,
          label: "RECOMMENDATION",
          text: plan.message,
          warnings: []
        };
      }
      if (plan.status === "clarification") {
        return {
          kind: "clarification",
          intentTool: intent.tool,
          message: plan.message,
          ambiguities: plan.ambiguities
        };
      }

      const requiresOwnerPin = isProtectedAiTool(intent.tool);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min TTL
      const token = await this.audit.createActionToken(
        context.ownerId,
        context.branchId,
        context.userId,
        intent.tool,
        plan.plan,
        requiresOwnerPin,
        expiresAt
      );

      await this.audit.log({
        ownerId: context.ownerId,
        branchId: context.branchId,
        actorUserId: context.userId,
        actorRole: context.role,
        commandText: text,
        transcription: null,
        intentKind: "ACTION",
        intentTool: intent.tool,
        label: null,
        confirmationToken: token.tokenId,
        authorizationId: null,
        resultJson: null
      });

      return {
        kind: "action_preview",
        token: token.tokenId,
        operationId: plan.plan.operationId,
        intentTool: intent.tool,
        summary: plan.plan.summary,
        amountCents: plan.plan.amountCents,
        requiresOwnerPin,
        warnings: [],
        ambiguities: [],
        expiresAt: expiresAt.toISOString()
      };
    }

    return {
      kind: "query",
      intentTool: "SALES_SUMMARY",
      label: "CONFIRMED",
      text: "No entendí la solicitud. Prueba preguntar por ventas, fiado, inventario o caja.",
      warnings: []
    };
  }

  async confirmAction(
    tokenId: string,
    context: CommandContext,
    ownerAuthorizationId: string | null
  ): Promise<AiTurn> {
    const token = await this.audit.findActionToken(tokenId);
    if (!token) {
      return { kind: "action_result", intentTool: "REGISTER_ABONO", ok: false, operationId: null, message: "Token de confirmación no encontrado." };
    }
    if (token.consumedAt) {
      return { kind: "action_result", intentTool: token.intentTool as AiToolName, ok: false, operationId: null, message: "Esa acción ya fue ejecutada." };
    }
    if (token.expiresAt.getTime() < Date.now()) {
      return { kind: "action_result", intentTool: token.intentTool as AiToolName, ok: false, operationId: null, message: "La confirmación expiró. Vuelve a intentarlo." };
    }
    if (token.ownerId !== context.ownerId || token.branchId !== context.branchId) {
      return { kind: "action_result", intentTool: token.intentTool as AiToolName, ok: false, operationId: null, message: "La acción no pertenece a esta sucursal." };
    }

    const plan = token.payload as unknown as AiActionPlan;
    const requiresOwnerPin = token.requiresOwnerPin;
    if (requiresOwnerPin && !ownerAuthorizationId && context.role !== "OWNER") {
      return { kind: "action_result", intentTool: token.intentTool as AiToolName, ok: false, operationId: null, message: "Se requiere el PIN del dueño para esta acción." };
    }

    const payload = ownerAuthorizationId ? { ...plan.payload, ownerAuthorizationId } : plan.payload;
    const effectivePlan: AiActionPlan = { ...plan, payload };
    const result = await executeActionPlan(effectivePlan, context);
    await this.audit.consumeActionToken(tokenId);

    await this.audit.log({
      ownerId: context.ownerId,
      branchId: context.branchId,
      actorUserId: context.userId,
      actorRole: context.role,
      commandText: "",
      transcription: null,
      intentKind: "ACTION",
      intentTool: token.intentTool,
      label: result.status === "ACCEPTED" ? "CONFIRMED" : "ESTIMATED",
      confirmationToken: tokenId,
      authorizationId: ownerAuthorizationId,
      resultJson: JSON.stringify(result)
    });

    return {
      kind: "action_result",
      intentTool: token.intentTool as AiToolName,
      ok: result.status === "ACCEPTED",
      operationId: result.operationId,
      message: result.status === "ACCEPTED" ? "Acción confirmada y ejecutada." : `No se pudo ejecutar: ${result.errorCode ?? "rechazada"}.`
    };
  }
}
