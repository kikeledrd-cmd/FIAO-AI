import { z } from "zod";

export const AI_QUERY_TOOL_NAMES = [
  "SALES_SUMMARY",
  "CREDIT_SUMMARY",
  "CUSTOMER_BALANCE",
  "INVENTORY_STATUS",
  "CASH_STATUS",
  "ORDERS_STATUS"
] as const;
export type AiQueryToolName = (typeof AI_QUERY_TOOL_NAMES)[number];

export const AI_ACTION_TOOL_NAMES = [
  "REGISTER_ABONO",
  "CREATE_ORDER",
  "OPEN_CASH",
  "CREATE_SALE",
  "STOCK_ADJUSTMENT"
] as const;
export type AiActionToolName = (typeof AI_ACTION_TOOL_NAMES)[number];

export const AI_TOOL_NAMES = [...AI_QUERY_TOOL_NAMES, ...AI_ACTION_TOOL_NAMES] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export const aiToolNameSchema = z.enum(AI_TOOL_NAMES);
export const aiIntentKindSchema = z.enum(["QUERY", "ACTION"]);
export const aiResponseLabelSchema = z.enum(["CONFIRMED", "ESTIMATED", "RECOMMENDATION"]);
export const aiActorRoleSchema = z.enum(["OWNER", "CASHIER"]);

/** Candidato de entidad para resolución de ambigüedad (nunca auto-resuelto). */
export const aiEntityOptionSchema = z.object({
  key: z.string().min(1).max(40),
  id: z.uuid(),
  label: z.string().max(120),
  hint: z.string().max(200).optional()
});
export type AiEntityOption = z.infer<typeof aiEntityOptionSchema>;

/** Consulta de solo lectura. */
export const aiQueryRequestSchema = z.object({
  branchId: z.uuid(),
  text: z.string().min(1).max(500)
});
export type AiQueryRequest = z.infer<typeof aiQueryRequestSchema>;

export const aiQueryResponseSchema = z.object({
  intentTool: aiToolNameSchema,
  label: aiResponseLabelSchema,
  text: z.string(),
  data: z.unknown().optional(),
  warnings: z.array(z.string()),
  ambiguities: z.array(aiEntityOptionSchema)
});
export type AiQueryResponse = z.infer<typeof aiQueryResponseSchema>;

/** Preparación de una acción (genera token de confirmación). */
export const aiActionPrepareRequestSchema = z.object({
  branchId: z.uuid(),
  text: z.string().min(1).max(500)
});
export type AiActionPrepareRequest = z.infer<typeof aiActionPrepareRequestSchema>;

export const aiActionPreviewSchema = z.object({
  token: z.uuid(),
  operationId: z.uuid(),
  intentTool: aiToolNameSchema,
  summary: z.string(),
  amountCents: z.number().int().nonnegative().nullable(),
  requiresOwnerPin: z.boolean(),
  warnings: z.array(z.string()),
  ambiguities: z.array(aiEntityOptionSchema),
  expiresAt: z.string().datetime()
});
export type AiActionPreview = z.infer<typeof aiActionPreviewSchema>;

/** Confirmación/ejecución de una acción preparada. */
export const aiActionConfirmRequestSchema = z.object({
  token: z.uuid(),
  branchId: z.uuid(),
  /** Resolución de ambigüedades: key → id de entidad. */
  resolution: z.record(z.string(), z.string()).optional(),
  ownerAuthorizationId: z.uuid().nullable().optional()
});
export type AiActionConfirmRequest = z.infer<typeof aiActionConfirmRequestSchema>;

export const aiActionResultSchema = z.object({
  ok: z.boolean(),
  operationId: z.uuid().nullable(),
  message: z.string(),
  data: z.unknown().optional()
});
export type AiActionResult = z.infer<typeof aiActionResultSchema>;

/** Autorización OWNER para una acción protegida. */
export const aiAuthorizeRequestSchema = z.object({
  branchId: z.uuid(),
  purpose: z.enum(["STOCK_ADJUSTMENT"]),
  targetOperationId: z.uuid(),
  pin: z.string().min(1).max(32)
});
export type AiAuthorizeRequest = z.infer<typeof aiAuthorizeRequestSchema>;

/** Entrada de audit log (append-only). */
export const aiAuditLogEntrySchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  branchId: z.uuid(),
  actorUserId: z.uuid(),
  actorRole: aiActorRoleSchema,
  commandText: z.string(),
  transcription: z.string().nullable(),
  intentKind: aiIntentKindSchema,
  intentTool: aiToolNameSchema,
  label: aiResponseLabelSchema.nullable(),
  confirmationToken: z.uuid().nullable(),
  authorizationId: z.uuid().nullable(),
  resultJson: z.string().nullable(),
  createdAt: z.string().datetime()
});
export type AiAuditLogEntry = z.infer<typeof aiAuditLogEntrySchema>;
