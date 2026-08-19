import { settingsUpdateSchema } from "@fiao/contracts/settings";
import { SettingsRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({ branchId: z.uuid() });

type LoadContext = typeof requireBranchContext;

export function createSettingsHandler(dependencies?: { repository?: SettingsRepository; loadContext?: LoadContext }) {
  const repository = dependencies?.repository ?? new SettingsRepository();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  async function get(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    try {
      const context = await loadContext(parsed.data.branchId);
      const settings = await repository.getByBranch(context.ownerId, context.branchId);
      return NextResponse.json({ settings });
    } catch (error) {
      return handleError(error);
    }
  }

  async function put(request: Request): Promise<NextResponse> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const bodySchema = settingsUpdateSchema.extend({ branchId: z.uuid() });
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const { branchId, ...update } = parsed.data;
    try {
      const context = await loadContext(branchId);
      // La configuración solo la cambia el dueño.
      if (context.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      const settings = await repository.update(context.ownerId, context.branchId, update);
      return NextResponse.json({ settings });
    } catch (error) {
      return handleError(error);
    }
  }

  return { get, put };
}

function handleError(error: unknown): NextResponse {
  if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (error instanceof Error && (error.message === "FORBIDDEN" || error.message.startsWith("FORBIDDEN_"))) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  throw error;
}
