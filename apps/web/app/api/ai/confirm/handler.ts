import { NextResponse } from "next/server";
import { z } from "zod";
import { AiOrchestrator } from "@/lib/ai/orchestrator";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const bodySchema = z.object({
  branchId: z.uuid(),
  token: z.uuid(),
  ownerAuthorizationId: z.uuid().nullable().optional()
});

type LoadContext = typeof requireBranchContext;

export function createAiConfirmHandler(dependencies?: { orchestrator?: AiOrchestrator; loadContext?: LoadContext }) {
  const orchestrator = dependencies?.orchestrator ?? new AiOrchestrator();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  return async function aiConfirm(request: Request): Promise<NextResponse> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadContext(parsed.data.branchId);
      const turn = await orchestrator.confirmAction(parsed.data.token, context, parsed.data.ownerAuthorizationId ?? null);
      return NextResponse.json({ turn });
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
