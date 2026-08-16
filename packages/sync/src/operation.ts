import type { ClientOperationEnvelope } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";

export const FOUNDATION_OPERATION_TYPES = ["NOOP"] as const;
export type FoundationOperationType = (typeof FOUNDATION_OPERATION_TYPES)[number];

export const COMMERCE_OPERATION_TYPES = [
  "SALE",
  "CUSTOMER_UPSERT",
  "ABONO",
  "STOCK_ADJUSTMENT",
  "SALE_REVERSAL",
  "SUPPLIER_UPSERT",
  "PURCHASE",
  "CASH_OPEN",
  "CASH_EXPENSE",
  "CASH_WITHDRAWAL",
  "CASH_INJECTION",
  "CASH_CLOSE"
] as const;
export type CommerceOperationType = (typeof COMMERCE_OPERATION_TYPES)[number];

export const ALL_OPERATION_TYPES = [...FOUNDATION_OPERATION_TYPES, ...COMMERCE_OPERATION_TYPES] as const;
export type AllOperationType = (typeof ALL_OPERATION_TYPES)[number];

export function isFoundationOperationType(type: string): type is FoundationOperationType {
  return (FOUNDATION_OPERATION_TYPES as readonly string[]).includes(type);
}

export function isCommerceOperationType(type: string): type is CommerceOperationType {
  return (COMMERCE_OPERATION_TYPES as readonly string[]).includes(type);
}

export function assertOperationScope(context: CommandContext, envelope: ClientOperationEnvelope): void {
  if (envelope.ownerId !== context.ownerId) throw new Error("FORBIDDEN_OWNER_SCOPE");
  if (envelope.branchId !== context.branchId) throw new Error("FORBIDDEN_BRANCH_SCOPE");
  if (envelope.actorUserId !== context.userId) throw new Error("FORBIDDEN_ACTOR_SCOPE");
  if (envelope.deviceId !== context.deviceId) throw new Error("FORBIDDEN_DEVICE_SCOPE");
}

export function parseOperationTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_OCCURRED_AT");
  return parsed;
}

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function parseCursor(value: string | null): bigint | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new Error("INVALID_CURSOR");
  const cursor = BigInt(value);
  if (cursor > POSTGRES_BIGINT_MAX) throw new Error("INVALID_CURSOR");
  return cursor;
}

export function normalizeJsonPayload(payload: unknown): unknown {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error("INVALID_OPERATION_PAYLOAD");
  return JSON.parse(serialized) as unknown;
}
