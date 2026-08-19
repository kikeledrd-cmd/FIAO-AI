export { FIAO_DOMAIN_VERSION } from "./version";
export type { CommandContext } from "./context";
export { validatePin } from "./auth/pin-policy";
export {
  addDecimalQuantities,
  computeLineTotals,
  parseSaleQuantity,
  paymentTotalCents,
  saleLineTotalCents,
  subtractDecimalQuantities,
  subtotalCents,
  validateSale
} from "./sales/sale-policy";
export type { SaleLineTotal, SalePolicyResult } from "./sales/sale-policy";
export {
  computeFiaoScore,
  creditBalanceCents,
  parseMoneyCents,
  assertCreditLimit,
  assertAbonoValid
} from "./credit/credit-policy";
export type { CreditMovementInput, FiaoScore, FiaoScoreInput } from "./credit/credit-policy";
export { can } from "./auth/permissions";
export type { Permission } from "./auth/permissions";
export { isOwnerAuthorizer, ownerAuthorizationExpiresAt, OWNER_AUTHORIZATION_TTL_MS } from "./auth/authorize-owner";
export type { OwnerAuthorizationScope } from "./auth/authorize-owner";
export { applyStockDelta, parseAdjustmentDelta } from "./inventory/inventory-policy";
export { assertPurchaseLineValid, computeMovingAverageCost } from "./purchasing/purchase-policy";
export {
  assertCanClose,
  assertExpenseAllowed,
  assertNonNegativeCents,
  assertOwnerProtectedMovement,
  assertPositiveCents,
  CASHIER_EXPENSE_LIMIT_CENTS,
  computeExpectedCash
} from "./cash/cash-policy";
export type { ExpectedCashInput } from "./cash/cash-policy";
export {
  addReservation,
  assertApartadoCreateValid,
  assertApartadoLineValid,
  assertApartadoTransitionValid,
  availableQuantity,
  releaseReservation
} from "./apartado/apartado-policy";
export type { ApartadoStatus } from "./apartado/apartado-policy";
export {
  assertRedemptionAllowed,
  computeLoyaltyBalance,
  computePointsEarned,
  loyaltyExpiresAt
} from "./loyalty/loyalty-policy";
export type { LoyaltyMovementType } from "./loyalty/loyalty-policy";
export { applyPromotions } from "./promotions/promotion-policy";
export type {
  DiscountedCartLine,
  PromotionInput,
  PromotionKind,
  PromotionResult,
  PromotionScope
} from "./promotions/promotion-policy";
export {
  assertOrderTransitionValid,
  finalizesSaleOnTransition,
  orderCancelRequiresAuthorization,
  ORDER_STATUS_LABEL,
  reservesStockOnTransition
} from "./orders/order-policy";
export type { OrderSource, OrderStatus } from "./orders/order-policy";
export { extractOrderLines, normalizeOrderText } from "./orders/order-extraction";
export type {
  ExtractedOrderLine,
  OrderCatalogItem,
  OrderExtractionResult
} from "./orders/order-extraction";
export {
  AI_ACTION_TOOLS,
  AI_PROTECTED_TOOLS,
  AI_QUERY_TOOLS,
  AI_RESPONSE_LABELS,
  detectAnomalousAmount,
  extractAmountCents,
  isAiActionTool,
  isAiQueryTool,
  isProtectedAiTool,
  normalizeAiText,
  parseAiIntent
} from "./ai/ai-intent";
export type {
  AiActionTool,
  AiIntent,
  AiIntentKind,
  AiProtectedTool,
  AiQueryTool,
  AiResponseLabel,
  AiToolName
} from "./ai/ai-intent";
export {
  estimatedProfitCents,
  percentChange,
  previousPeriodStart,
  profitLabel,
  startOfDay,
  stockLabel
} from "./reports/report-policy";
export type { ReportLabel } from "./reports/report-policy";
