import { parseSaleQuantity } from "../sales/sale-policy";

export type PromotionKind = "PERCENT_OFF" | "FIXED_OFF" | "BUNDLE_BUY_X_GET_Y";
export type PromotionScope = "PRODUCT" | "TOTAL";

export interface PromotionInput {
  id: string;
  kind: PromotionKind;
  scope: PromotionScope;
  /** Para promos de scope PRODUCT. */
  productId?: string | null;
  /** PERCENT_OFF: puntos base por 10000 (ej. 1500 = 15%). */
  percentOffCents?: number | null;
  /** FIXED_OFF: descuento fijo en centavos. */
  fixedOffCents?: number | null;
  /** BUNDLE: compras X unidades. */
  buyQty?: number | null;
  /** BUNDLE: lleva Y unidades gratis. */
  getQty?: number | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface CartLineInput {
  productId: string;
  quantity: string;
  priceCents: number;
}

export interface DiscountedCartLine extends CartLineInput {
  /** Descuento aplicado a la línea (centavos). */
  discountCents: number;
  /** Promo aplicada (id), si alguna. */
  promotionId?: string | null;
}

export interface PromotionResult {
  lines: DiscountedCartLine[];
  totalDiscountCents: number;
  appliedPromotionIds: string[];
}

function isActive(promotion: PromotionInput, now: Date): boolean {
  if (!promotion.active) return false;
  if (promotion.startsAt && new Date(promotion.startsAt).getTime() > now.getTime()) {
    return false;
  }
  if (promotion.endsAt && new Date(promotion.endsAt).getTime() < now.getTime()) {
    return false;
  }
  return true;
}

function lineTotalCents(line: CartLineInput): number {
  const { scaled } = parseSaleQuantity(line.quantity);
  return Math.round((Number(scaled) * line.priceCents) / 1000);
}

/** Descuento por línea de una promo de scope PRODUCT (o bundle). */
function productLineDiscount(
  promotion: PromotionInput,
  line: CartLineInput
): number {
  const total = lineTotalCents(line);
  if (total <= 0) return 0;
  switch (promotion.kind) {
    case "PERCENT_OFF": {
      const percent = promotion.percentOffCents ?? 0;
      if (percent <= 0) return 0;
      return Math.round((total * percent) / 10000);
    }
    case "FIXED_OFF": {
      const fixed = promotion.fixedOffCents ?? 0;
      if (fixed <= 0) return 0;
      return Math.min(fixed, total);
    }
    case "BUNDLE_BUY_X_GET_Y": {
      const buyQty = promotion.buyQty ?? 0;
      const getQty = promotion.getQty ?? 0;
      if (buyQty <= 0 || getQty <= 0) return 0;
      const { scaled } = parseSaleQuantity(line.quantity);
      const units = Math.floor(Number(scaled) / 1000);
      const freeUnits = Math.floor(units / (buyQty + getQty)) * getQty;
      return freeUnits * line.priceCents;
    }
  }
}

/** Descuento de una promo de scope TOTAL sobre el subtotal. */
function totalDiscount(promotion: PromotionInput, subtotal: number): number {
  if (subtotal <= 0) return 0;
  switch (promotion.kind) {
    case "PERCENT_OFF": {
      const percent = promotion.percentOffCents ?? 0;
      if (percent <= 0) return 0;
      return Math.round((subtotal * percent) / 10000);
    }
    case "FIXED_OFF": {
      const fixed = promotion.fixedOffCents ?? 0;
      if (fixed <= 0) return 0;
      return Math.min(fixed, subtotal);
    }
    default:
      return 0;
  }
}

/**
 * Aplica promociones de forma **determinística**: mismo input (líneas,
 * promos, `now`) → mismo output. Sin azar ni hora local del cliente.
 *
 * Reglas V1:
 * - Las promos de scope PRODUCT aplican solo a su `productId` (una por
 *   línea: la de mayor descuento; no apilable).
 * - Las promos de scope TOTAL aplican sobre el subtotal (una sola: la de
 *   mayor descuento).
 * - Se elige el mayor descuento entre la suma de descuentos por línea y el
 *   descuento TOTAL (nunca ambos).
 * - El descuento por línea nunca excede el total de la línea.
 */
export function applyPromotions(
  cartLines: CartLineInput[],
  promotions: PromotionInput[],
  now: Date
): PromotionResult {
  const active = promotions.filter((promotion) => isActive(promotion, now));

  // Descuentos por línea (PRODUCT / BUNDLE).
  const lines: DiscountedCartLine[] = cartLines.map((line) => {
    const candidates = active
      .filter((promotion) => promotion.scope === "PRODUCT" && promotion.productId === line.productId)
      .map((promotion) => ({
        promotion,
        discount: productLineDiscount(promotion, line)
      }));
    if (candidates.length === 0) {
      return { ...line, discountCents: 0, promotionId: null };
    }
    const best = candidates.reduce((a, b) => (b.discount > a.discount ? b : a));
    return {
      ...line,
      discountCents: Math.min(best.discount, lineTotalCents(line)),
      promotionId: best.discount > 0 ? best.promotion.id : null
    };
  });

  const lineDiscount = lines.reduce((sum, line) => sum + line.discountCents, 0);

  // Descuento TOTAL (una sola promo, la de mayor descuento).
  const subtotal = cartLines.reduce((sum, line) => sum + lineTotalCents(line), 0);
  const totalCandidates = active
    .filter((promotion) => promotion.scope === "TOTAL")
    .map((promotion) => ({
      promotion,
      discount: totalDiscount(promotion, subtotal)
    }));
  const bestTotal =
    totalCandidates.length > 0
      ? totalCandidates.reduce((a, b) => (b.discount > a.discount ? b : a))
      : null;

  if (bestTotal && bestTotal.discount > lineDiscount) {
    const appliedPromotionIds = [bestTotal.promotion.id];
    return {
      lines: cartLines.map((line) => ({ ...line, discountCents: 0, promotionId: null })),
      totalDiscountCents: bestTotal.discount,
      appliedPromotionIds
    };
  }

  const appliedPromotionIds = [...new Set(lines.map((line) => line.promotionId).filter((id): id is string => id !== null))];
  return {
    lines,
    totalDiscountCents: lineDiscount,
    appliedPromotionIds
  };
}
