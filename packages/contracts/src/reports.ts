import { z } from "zod";

export const REPORT_TYPES = ["SALES", "PROFIT", "FIAO", "INVENTORY", "CASH", "CUSTOMERS", "ORDERS", "DASHBOARD"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABELS = ["CONFIRMED", "ESTIMATED", "RECOMMENDATION"] as const;
export type ReportLabel = (typeof REPORT_LABELS)[number];

/** Solicitud de exportación CSV (datasets esenciales). */
export const reportExportRequestSchema = z.object({
  dataset: z.enum(["SALES", "CUSTOMERS", "PRODUCTS"]),
  branchId: z.uuid(),
  format: z.enum(["csv"]).default("csv")
});
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;

export interface DashboardReport {
  label: ReportLabel;
  salesTodayCents: number;
  salesPreviousCents: number;
  salesChangePct: number | null;
  estimatedProfitCents: number;
  totalFiadoCents: number;
  lowStockCount: number;
  activeOrdersCount: number;
  cashOpen: boolean;
}

export interface SalesReport {
  label: ReportLabel;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  count: number;
  cashCents: number;
  transferCents: number;
  cardCents: number;
  fiadoCents: number;
  previousTotalCents: number;
  changePct: number | null;
}

export interface ProfitReport {
  label: ReportLabel;
  periodStart: string;
  periodEnd: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  count: number;
}

export interface FiaoReport {
  label: ReportLabel;
  totalFiadoCents: number;
  customersWithDebt: number;
  overdueCustomers: number;
  collectionsCents: number;
}

export interface InventoryReport {
  label: ReportLabel;
  totalProducts: number;
  lowStockCount: number;
  inventoryValueCents: number;
  lowStockItems: Array<{ productId: string; name: string; available: number }>;
}

export interface CashReport {
  label: ReportLabel;
  openSessionId: string | null;
  openingFloatCents: number | null;
  expectedCents: number | null;
  expensesCents: number;
  withdrawalsCents: number;
  injectionsCents: number;
}

export interface CustomersReport {
  label: ReportLabel;
  totalCustomers: number;
  activeCustomers: number;
  withDebt: number;
  totalFiadoCents: number;
  topDebtors: Array<{ name: string; balanceCents: number }>;
}

export interface OrdersReport {
  label: ReportLabel;
  total: number;
  active: number;
  byStatus: Record<string, number>;
}

/** Fila de exportación CSV (round-trip money/quantity). */
export interface CsvRow {
  [key: string]: string | number;
}
