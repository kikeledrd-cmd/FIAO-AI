import type { CommandContext } from "@fiao/domain/context";
import { OrderRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid()
});

type BranchContextLoader = (branchId: string) => Promise<CommandContext>;

export function createOrdersHandler(dependencies?: {
  loadBranchContext?: BranchContextLoader;
  repository?: OrderRepository;
}) {
  const loadBranchContext = dependencies?.loadBranchContext ?? requireBranchContext;
  const repository = dependencies?.repository ?? new OrderRepository();

  return async function orders(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadBranchContext(parsed.data.branchId);
      const items = await repository.listByBranch(context.ownerId, context.branchId);
      return NextResponse.json({ orders: items });
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
