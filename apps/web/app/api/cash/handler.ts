import type { CommandContext } from "@fiao/domain/context";
import { CashRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid()
});

type BranchContextLoader = (branchId: string) => Promise<CommandContext>;

export function createCashHandler(dependencies?: {
  loadBranchContext?: BranchContextLoader;
  repository?: CashRepository;
}) {
  const loadBranchContext = dependencies?.loadBranchContext ?? requireBranchContext;
  const repository = dependencies?.repository ?? new CashRepository();

  return async function cash(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadBranchContext(parsed.data.branchId);
      const state = await repository.getState(context);
      return NextResponse.json(state);
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
