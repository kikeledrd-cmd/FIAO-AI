import { NextResponse } from "next/server";
import { z } from "zod";
import { AiOrchestrator } from "@/lib/ai/orchestrator";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const bodySchema = z.object({
  branchId: z.uuid(),
  text: z.string().min(1).max(500),
  transcription: z.string().max(1000).nullable().optional(),
  customerId: z.uuid().nullable().optional(),
  productId: z.uuid().nullable().optional(),
  quantityDelta: z.string().max(32).nullable().optional(),
  reason: z.string().max(300).nullable().optional(),
  amountCents: z.number().int().positive().nullable().optional()
});

type LoadContext = typeof requireBranchContext;

export function createAiMessageHandler(dependencies?: { orchestrator?: AiOrchestrator; loadContext?: LoadContext }) {
  const orchestrator = dependencies?.orchestrator ?? new AiOrchestrator();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  return async function aiMessage(request: Request): Promise<NextResponse> {
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
      const overrides = {
        customerId: parsed.data.customerId ?? null,
        productId: parsed.data.productId ?? null,
        quantityDelta: parsed.data.quantityDelta ?? null,
        reason: parsed.data.reason ?? null,
        amountCents: parsed.data.amountCents ?? null
      };
      const turn = await orchestrator.handleMessage(parsed.data.text, context, overrides);
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
