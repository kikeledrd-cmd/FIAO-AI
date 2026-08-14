import type { OperationResult, SyncChangeRecord } from "@fiao/contracts/sync";
import { databaseClient, type FiaoPrismaClient } from "../client";

export interface PullChangesResult {
  changes: SyncChangeRecord[];
  nextCursor: string;
  hasMore: boolean;
}

export class SyncRepository {
  constructor(private readonly db: FiaoPrismaClient = databaseClient) {}

  async findOperationResult(ownerId: string, operationId: string): Promise<OperationResult | null> {
    const operation = await this.db.clientOperation.findUnique({
      where: { ownerId_operationId: { ownerId, operationId } },
      select: { operationId: true, status: true, result: true, latestCursor: true }
    });
    if (!operation?.status || operation.latestCursor === null) return null;

    const persisted = isRecord(operation.result) ? operation.result : {};
    return {
      operationId: operation.operationId,
      status: operation.status,
      ...(typeof persisted.conflictId === "string" ? { conflictId: persisted.conflictId } : {}),
      ...(typeof persisted.errorCode === "string" ? { errorCode: persisted.errorCode } : {}),
      latestCursor: operation.latestCursor.toString()
    };
  }

  async latestCursor(ownerId: string, branchId: string): Promise<string> {
    const latest = await this.db.syncChange.findFirst({
      where: { ownerId, branchId },
      orderBy: { seq: "desc" },
      select: { seq: true }
    });
    return (latest?.seq ?? 0n).toString();
  }

  async pullChanges(ownerId: string, branchId: string, after: bigint, limit: number): Promise<PullChangesResult> {
    const rows = await this.db.syncChange.findMany({
      where: { ownerId, branchId, seq: { gt: after } },
      orderBy: { seq: "asc" },
      take: limit + 1,
      select: { seq: true, ownerId: true, branchId: true, type: true, payload: true, createdAt: true }
    });
    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = visible.at(-1)?.seq ?? after;

    return {
      changes: visible.map((row) => ({
        cursor: row.seq.toString(),
        ownerId: row.ownerId,
        branchId: row.branchId,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt.toISOString()
      })),
      nextCursor: nextCursor.toString(),
      hasMore
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
