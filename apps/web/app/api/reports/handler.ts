import { REPORT_TYPES, type ReportType } from "@fiao/contracts/reports";
import { ReportRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid(),
  type: z.enum(REPORT_TYPES)
});

const OWNER_ONLY: ReportType[] = ["PROFIT", "DASHBOARD"];

type LoadContext = typeof requireBranchContext;

export function createReportsHandler(dependencies?: { repository?: ReportRepository; loadContext?: LoadContext }) {
  const repository = dependencies?.repository ?? new ReportRepository();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  return async function reports(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId"), type: url.searchParams.get("type") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadContext(parsed.data.branchId);
      if (OWNER_ONLY.includes(parsed.data.type) && context.role !== "OWNER") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }

      const type = parsed.data.type;
      let report: unknown;
      switch (type) {
        case "DASHBOARD":
          report = await repository.dashboard(context.ownerId, context.branchId);
          break;
        case "SALES":
          report = await repository.sales(context.ownerId, context.branchId);
          break;
        case "PROFIT":
          report = await repository.profit(context.ownerId, context.branchId);
          break;
        case "FIAO":
          report = await repository.fiao(context.ownerId, context.branchId);
          break;
        case "INVENTORY":
          report = await repository.inventory(context.ownerId, context.branchId);
          break;
        case "CASH":
          report = await repository.cash(context.ownerId, context.branchId);
          break;
        case "CUSTOMERS":
          report = await repository.customers(context.ownerId, context.branchId);
          break;
        case "ORDERS":
          report = await repository.orders(context.ownerId, context.branchId);
          break;
        default:
          return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
      }
      return NextResponse.json({ report });
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
