import { AnalyticsRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { requireSession, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

export function createAnalyticsSummaryHandler(dependencies?: { repository?: AnalyticsRepository }) {
  const repository = dependencies?.repository ?? new AnalyticsRepository();

  return async function analyticsSummary(): Promise<NextResponse> {
    try {
      const session = await requireSession();
      if (session.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      const summary = await repository.summary(session.ownerId);
      return NextResponse.json({ summary });
    } catch (error) {
      if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      throw error;
    }
  };
}
