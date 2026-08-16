import type { ClientOperationEnvelope, OperationResult } from "@fiao/contracts/sync";
import type { CommandContext } from "@fiao/domain/context";
import { processOperation as processPersistedOperation, SyncRepository } from "@fiao/database";
import { assertOperationScope, parseCursor, ALL_OPERATION_TYPES } from "@fiao/sync/operation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const uuid = z.uuid();
const cursor = z.string().regex(/^\d+$/).refine((value) => {
  try {
    parseCursor(value);
    return true;
  } catch {
    return false;
  }
}).nullable();
const operationSchema = z.object({
  operationId: uuid,
  type: z.enum(ALL_OPERATION_TYPES),
  ownerId: uuid,
  branchId: uuid,
  actorUserId: uuid,
  deviceId: uuid,
  occurredAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  baseCursor: cursor,
  payload: z.unknown()
});
const pushSchema = z.object({
  branchId: uuid,
  operations: z.array(operationSchema).max(100)
});

type BranchContextLoader = (branchId: string) => Promise<CommandContext>;
type OperationProcessor = (context: CommandContext, envelope: ClientOperationEnvelope) => Promise<OperationResult>;
interface CursorRepository { latestCursor(ownerId: string, branchId: string): Promise<string> }

export function createPushHandler(dependencies?: {
  loadBranchContext?: BranchContextLoader;
  processOperation?: OperationProcessor;
  syncRepository?: CursorRepository;
}) {
  const loadBranchContext = dependencies?.loadBranchContext ?? requireBranchContext;
  const processOperation = dependencies?.processOperation ?? ((context, envelope) => processPersistedOperation(context, envelope));
  const syncRepository = dependencies?.syncRepository ?? new SyncRepository();

  return async function push(request: Request): Promise<NextResponse> {
    const parsed = pushSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadBranchContext(parsed.data.branchId);
      const operations = parsed.data.operations as ClientOperationEnvelope[];

      // Preflight the whole batch before any write so an auth/scope failure cannot partially commit.
      for (const operation of operations) assertOperationScope(context, operation);

      const results: OperationResult[] = [];
      for (const operation of operations) {
        results.push(await processOperation(context, operation));
      }
      const branchCursor = await syncRepository.latestCursor(context.ownerId, context.branchId);
      return NextResponse.json({ results, cursor: branchCursor });
    } catch (error) {
      return syncErrorResponse(error);
    }
  };
}

function syncErrorResponse(error: unknown): NextResponse {
  if (error instanceof SessionRequiredError) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (error instanceof Error && (error.message === "FORBIDDEN" || error.message.startsWith("FORBIDDEN_"))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  throw error;
}
