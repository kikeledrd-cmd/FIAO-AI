export { AuthRepository } from "./repositories/auth-repository";
export { CatalogRepository } from "./repositories/catalog-repository";
export { databaseClient } from "./client";
export type { FiaoPrismaClient } from "./client";
export type {
  ActiveSessionRecord,
  BranchAccess,
  CreateOwnerAuthorizationInput,
  CreateSessionInput,
  LoginUserRecord,
  OwnerAuthorizerRecord,
  UserContextRecord
} from "./repositories/auth-repository";

export { SyncRepository } from "./repositories/sync-repository";
export type { PullChangesResult } from "./repositories/sync-repository";
export { processOperation } from "./transactions/process-operation";
export { processSaleOperation } from "./transactions/process-sale";
export { processCustomerUpsert } from "./transactions/process-customer";
export { processAbonoOperation } from "./transactions/process-abono";
export { processStockAdjustment } from "./transactions/process-stock-adjustment";
export { processSaleReversal } from "./transactions/process-sale-reversal";
export { processSupplierUpsert } from "./transactions/process-supplier-upsert";
export { processPurchase } from "./transactions/process-purchase";
export { processCashOpen } from "./transactions/process-cash-open";
export { processCashMovement } from "./transactions/process-cash-movement";
export { processCashClose } from "./transactions/process-cash-close";
export { computeExpectedCashForSession } from "./transactions/cash-shared";
export { CustomerRepository } from "./repositories/customer-repository";
export { SupplierRepository } from "./repositories/supplier-repository";
export { CashRepository } from "./repositories/cash-repository";
export type { CashStateResult } from "./repositories/cash-repository";
export { ApartadoRepository } from "./repositories/apartado-repository";
export { LoyaltyRepository } from "./repositories/loyalty-repository";
export type { CustomerLoyalty } from "./repositories/loyalty-repository";
export { OrderRepository } from "./repositories/order-repository";
export { AiAuditRepository, AiQueryRepository } from "./repositories/ai-repository";
export type {
  AiActionTokenRow,
  AiAuditLogInput,
  CashStatus,
  CreditSummary,
  CustomerMatch,
  InventoryStatusItem,
  OrdersStatus,
  SalesSummary
} from "./repositories/ai-repository";
export { buildActionPlan, executeActionPlan, runAiQuery } from "./ai/tools";
export type {
  AiActionParams,
  AiActionPlan,
  AiActionPlanResult,
  AiLabel,
  AiQueryResult
} from "./ai/tools";
export { ReportRepository } from "./repositories/report-repository";
export { DeviceRepository, OnboardingRepository, SettingsRepository } from "./repositories/settings-repository";
export { AnalyticsRepository } from "./repositories/analytics-repository";
export type { PilotSummary } from "./repositories/analytics-repository";
