import { AnalyticsRepository, AuthRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const ALLOWED_EVENTS = new Set(["USER_LOGIN", "SYNC_CONFLICT", "APP_OPEN", "OFFLINE_QUEUE_DRAINED"]);

const eventSchema = z.object({
  eventName: z.string().min(1).max(80),
  branchId: z.uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export function createAnalyticsEventHandler(dependencies?: { repository?: AnalyticsRepository }) {
  const repository = dependencies?.repository ?? new AnalyticsRepository();

  return async function analyticsEvent(request: Request): Promise<NextResponse> {
    try {
      const session = await requireSession();
      const parsed = eventSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success || !ALLOWED_EVENTS.has(parsed.data.eventName)) {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
      }

      let branchId: string | null = null;
      if (parsed.data.branchId) {
        const auth = new AuthRepository();
        try {
          const access = await auth.verifyBranchAccess(session.userId, parsed.data.branchId);
          if (access.ownerId !== session.ownerId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
          branchId = access.branchId;
        } catch {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
      }

      await repository.record({
        ownerId: session.ownerId,
        branchId,
        eventName: parsed.data.eventName,
        metadata: parsed.data.metadata
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      throw error;
    }
  };
}
