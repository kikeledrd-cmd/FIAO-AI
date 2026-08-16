import type { CommandContext } from "@fiao/domain/context";
import { SyncRepository, type PullChangesResult } from "@fiao/database";
import { parseCursor } from "@fiao/sync/operation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid(),
  after: z.string().regex(/^\d+$/).default("0"),
  limit: z.coerce.number().int().min(1).max(500).default(500)
});

type BranchContextLoader = (branchId: string) => Promise<CommandContext>;
interface PullRepository {
  pullChanges(ownerId: string, branchId: string, after: bigint, limit: number): Promise<PullChangesResult>;
}

export function createPullHandler(dependencies?: {
  loadBranchContext?: BranchContextLoader;
  syncRepository?: PullRepository;
}) {
  const loadBranchContext = dependencies?.loadBranchContext ?? requireBranchContext;
  const syncRepository = dependencies?.syncRepository ?? new SyncRepository();

  return async function pull(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      branchId: url.searchParams.get("branchId"),
      after: url.searchParams.get("after") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    let after: bigint;
    try {
      after = parseCursor(parsed.data.after) ?? 0n;
    } catch {
      return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 });
    }

    try {
      const context = await loadBranchContext(parsed.data.branchId);
      const result = await syncRepository.pullChanges(context.ownerId, context.branchId, after, parsed.data.limit);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof SessionRequiredError) {
        return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      }
      if (error instanceof Error && (error.message === "FORBIDDEN" || error.message.startsWith("FORBIDDEN_"))) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      throw error;
    }
  };
}
