import type { CsvRow } from "@fiao/contracts/reports";
import { ReportRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchContext, SessionRequiredError } from "@/lib/session/current-session";
import { toCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";

const querySchema = z.object({
  branchId: z.uuid(),
  dataset: z.enum(["SALES", "CUSTOMERS", "PRODUCTS"])
});

const OWNER_ONLY_DATASETS = new Set(["PRODUCTS"]);

type LoadContext = typeof requireBranchContext;

export function createReportsExportHandler(dependencies?: { repository?: ReportRepository; loadContext?: LoadContext }) {
  const repository = dependencies?.repository ?? new ReportRepository();
  const loadContext = dependencies?.loadContext ?? requireBranchContext;

  return async function reportsExport(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ branchId: url.searchParams.get("branchId"), dataset: url.searchParams.get("dataset") });
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    try {
      const context = await loadContext(parsed.data.branchId);
      if (OWNER_ONLY_DATASETS.has(parsed.data.dataset) && context.role !== "OWNER") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }

      let rows: CsvRow[];
      switch (parsed.data.dataset) {
        case "SALES":
          rows = await repository.exportSales(context.ownerId, context.branchId);
          break;
        case "CUSTOMERS":
          rows = await repository.exportCustomers(context.ownerId, context.branchId);
          break;
        case "PRODUCTS":
          rows = await repository.exportProducts(context.ownerId, context.branchId);
          break;
        default:
          return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
      }

      const csv = toCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${parsed.data.dataset.toLowerCase()}.csv"`
        }
      });
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
