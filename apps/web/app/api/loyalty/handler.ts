import type { CommandContext } from "@fiao/domain/context";
import { LoyaltyRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid(),
  customerId: z.uuid().optional()
});

type BranchContextLoader = (branchId: string) => Promise<CommandContext>;

/** GET /api/loyalty?branchId=…&customerId=… → { config, loyalty }.
 *  Sin customerId devuelve solo la config del owner (regla de ganancia). */
export function createLoyaltyHandler(dependencies?: {
  loadBranchContext?: BranchContextLoader;
  repository?: LoyaltyRepository;
}) {
  const loadBranchContext = dependencies?.loadBranchContext ?? requireBranchContext;
  const repository = dependencies?.repository ?? new LoyaltyRepository();

  return async function loyalty(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      branchId: url.searchParams.get("branchId"),
      ...(url.searchParams.get("customerId") ? { customerId: url.searchParams.get("customerId") } : {})
    });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadBranchContext(parsed.data.branchId);
      const config = await repository.getConfig(context.ownerId);
      const loyalty = parsed.data.customerId
        ? await repository.getCustomerLoyalty(context.ownerId, context.branchId, parsed.data.customerId)
        : null;
      return NextResponse.json({ config, loyalty });
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
