export const AI_RESPONSE_LABELS = ["CONFIRMED", "ESTIMATED", "RECOMMENDATION"] as const;
export type AiResponseLabel = (typeof AI_RESPONSE_LABELS)[number];

/** Herramientas de solo lectura (consultas). */
export const AI_QUERY_TOOLS = [
  "SALES_SUMMARY",
  "CREDIT_SUMMARY",
  "CUSTOMER_BALANCE",
  "INVENTORY_STATUS",
  "CASH_STATUS",
  "ORDERS_STATUS"
] as const;
export type AiQueryTool = (typeof AI_QUERY_TOOLS)[number];

/** Herramientas de mutación (requieren confirmación humana). */
export const AI_ACTION_TOOLS = [
  "REGISTER_ABONO",
  "CREATE_ORDER",
  "OPEN_CASH",
  "CREATE_SALE",
  "STOCK_ADJUSTMENT"
] as const;
export type AiActionTool = (typeof AI_ACTION_TOOLS)[number];

/** Acciones que además requieren PIN del dueño. */
export const AI_PROTECTED_TOOLS = ["STOCK_ADJUSTMENT"] as const;
export type AiProtectedTool = (typeof AI_PROTECTED_TOOLS)[number];

export type AiToolName = AiQueryTool | AiActionTool;

export type AiIntentKind = "QUERY" | "ACTION";

export interface AiIntent {
  kind: AiIntentKind;
  tool: AiToolName;
  /** Parámetros crudos extraídos (monto en centavos, texto de cliente, etc.). */
  parameters: Record<string, unknown>;
  /** Señales de ambigüedad que el orquestador debe resolver contra la BD. */
  ambiguities: string[];
  rawText: string;
}

const QUERY_KEYWORDS: Record<AiQueryTool, string[]> = {
  SALES_SUMMARY: ["venta", "vendi", "vendido", "vendimos", "cuanto vendi", "ingreso"],
  CREDIT_SUMMARY: ["fiado", "fiao", "cartera", "deuda", "quien me debe"],
  CUSTOMER_BALANCE: ["saldo", "balance", "cuanto me debe"],
  INVENTORY_STATUS: ["inventario", "stock", "existencia", "agotado", "que me falta"],
  CASH_STATUS: ["caja", "efectivo", "cuanto hay"],
  ORDERS_STATUS: ["pedido", "pedidos", "orden", "ordenes"]
};

const ACTION_KEYWORDS: Record<AiActionTool, string[]> = {
  REGISTER_ABONO: ["abona", "abonar", "cobra", "cobrar", "recibir pago"],
  CREATE_ORDER: ["nuevo pedido", "crear pedido", "haz un pedido", "pedir para"],
  OPEN_CASH: ["abrir caja", "abre caja", "abre la caja", "abrir la caja", "apertura de caja", "iniciar caja", "apertura caja"],
  CREATE_SALE: ["vender", "registrar venta", "hacer una venta"],
  STOCK_ADJUSTMENT: ["ajusta", "ajustar", "correccion", "merma", "corregir inventario"]
};

export function isAiQueryTool(tool: string): tool is AiQueryTool {
  return (AI_QUERY_TOOLS as readonly string[]).includes(tool);
}

export function isAiActionTool(tool: string): tool is AiActionTool {
  return (AI_ACTION_TOOLS as readonly string[]).includes(tool);
}

export function isProtectedAiTool(tool: string): tool is AiProtectedTool {
  return (AI_PROTECTED_TOOLS as readonly string[]).includes(tool);
}

/** Normaliza texto libre para matching (minúsculas, sin acentos, sin símbolos). */
export function normalizeAiText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minúsculas + sin acentos, preservando dígitos, puntos y comas (para montos). */
function normalizeMoneyText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseMoneyValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

/** Extrae un monto en centavos de texto libre ("RD$500", "500 pesos", "con 2000"). */
export function extractAmountCents(text: string): number | null {
  const normalized = normalizeMoneyText(text);
  const patterns = [
    /rd\$\s*([\d,]+(?:\.\d{1,2})?)/,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:pesos|peso)/,
    /(?:con|de|por)\s+([\d,]+(?:\.\d{1,2})?)/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const cents = parseMoneyValue(match[1]);
      if (cents !== null) return cents;
    }
  }
  return null;
}

/** Match por palabra completa (frases multi-palabra usan substring). */
function matchesKeyword(normalized: string, keyword: string): boolean {
  if (keyword.includes(" ")) return normalized.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(normalized);
}

/**
 * Convierte texto libre a un intent estructurado (determinístico). Nunca
 * resuelve entidades (clientes/productos): deja el texto crudo para que el
 * orquestador lo resuelva contra la BD y devuelva opciones si es ambiguo.
 */
export function parseAiIntent(text: string): AiIntent {
  const rawText = text.trim();
  const normalized = normalizeAiText(text);
  const amountCents = extractAmountCents(text);

  for (const tool of AI_ACTION_TOOLS) {
    if (ACTION_KEYWORDS[tool].some((keyword) => matchesKeyword(normalized, keyword))) {
      const customerQuery = extractCustomerQuery(text);
      return {
        kind: "ACTION",
        tool,
        parameters: {
          ...(amountCents !== null ? { amountCents } : {}),
          ...(customerQuery ? { customerQuery } : {})
        },
        ambiguities: [],
        rawText
      };
    }
  }

  for (const tool of AI_QUERY_TOOLS) {
    if (QUERY_KEYWORDS[tool].some((keyword) => matchesKeyword(normalized, keyword))) {
      const customerQuery = extractCustomerQuery(text);
      const ambiguities: string[] = [];
      // Un monto sin contexto de cliente en un intent de saldo es ambiguo.
      if (tool === "CUSTOMER_BALANCE" && !customerQuery) {
        ambiguities.push("customer");
      }
      return {
        kind: "QUERY",
        tool,
        parameters: {
          ...(amountCents !== null ? { amountCents } : {}),
          ...(customerQuery ? { customerQuery } : {})
        },
        ambiguities,
        rawText
      };
    }
  }

  // Fallback determinístico: sin intent reconocido.
  return { kind: "QUERY", tool: "SALES_SUMMARY", parameters: {}, ambiguities: ["intent"], rawText };
}

/** Extrae un nombre de cliente candidato tras conectores ("de", "a", "cuánto debe"). */
function extractCustomerQuery(text: string): string | null {
  const normalized = normalizeAiText(text);
  const patterns = [
    /(?:saldo|balance|deuda)\s+de\s+([a-z]+(?:\s[a-z]+)?)/,
    /cuanto\s+me\s+debe\s+([a-z]+(?:\s[a-z]+)?)/,
    /\ba\s+([a-z]+(?:\s[a-z]+)?)\s*$/,
    /\bde\s+([a-z]+(?:\s[a-z]+)?)\s*$/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !isStopwordName(candidate)) return candidate;
  }
  return null;
}

function isStopwordName(value: string): boolean {
  return ["cuanto", "cuando", "donde", "quien", "hoy", "ayer", "manana", "pesos", "peso"].includes(value);
}

/** Heurística de monto anómalo: por encima de un umbral típico. */
export function detectAnomalousAmount(amountCents: number, typicalMaxCents: number): boolean {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return false;
  if (!Number.isSafeInteger(typicalMaxCents) || typicalMaxCents <= 0) return false;
  return amountCents > typicalMaxCents;
}
