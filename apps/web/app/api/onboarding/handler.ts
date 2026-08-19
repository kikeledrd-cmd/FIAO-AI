import { OnboardingRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({ branchId: z.uuid() });

type LoadContext = typeof requireBranchContext;

export function createOnboardingHandler(dependencies?: { repository?: OnboardingRepository; loadContext?: LoadContext }) {
  const repository = dependencies?.repository ?? new OnboardingRepository();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  return async function onboarding(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    try {
      const context = await loadContext(parsed.data.branchId);
      const state = await repository.getState(context.ownerId, context.branchId);
      return NextResponse.json({ state });
    } catch (error) {
      if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      if (error instanceof Error && (error.message === "FORBIDDEN" || error.message.startsWith("FORBIDDEN_"))) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      throw error;
    }
  };
}
