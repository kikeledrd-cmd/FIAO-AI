export type LoyaltyMovementType = "EARN" | "REDEEM" | "EXPIRE" | "REVERSAL";

export interface LoyaltyMovementInput {
  type: LoyaltyMovementType;
  pointsDelta: number;
  occurredAt: string;
  /** Solo EARN tiene vencimiento: occurredAt + expiryDays. */
  expiresAt?: string | null;
}

/**
 * Puntos ganados en una venta: floor(totalCents / pointsPerHundredCents),
 * aritmética entera (spec §8: "1 point per RD$100").
 */
export function computePointsEarned(
  totalCents: number,
  pointsPerHundredCents: number
): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("INVALID_TOTAL");
  }
  if (!Number.isSafeInteger(pointsPerHundredCents) || pointsPerHundredCents <= 0) {
    throw new Error("INVALID_POINTS_RATE");
  }
  return Math.floor(totalCents / pointsPerHundredCents);
}

function isExpired(movement: LoyaltyMovementInput, now: Date): boolean {
  if (!movement.expiresAt) return false;
  const expiresAt = new Date(movement.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Saldo de puntos computado desde el ledger: suma de deltas de movimientos
 * no vencidos (solo EARN vence; REDEEM/REVERSAL/EXPIRE no). Nunca negativo.
 */
export function computeLoyaltyBalance(
  movements: LoyaltyMovementInput[],
  now: Date,
  expiryDays: number
): number {
  if (!Number.isSafeInteger(expiryDays) || expiryDays <= 0) {
    throw new Error("INVALID_EXPIRY_DAYS");
  }
  let balance = 0;
  for (const movement of movements) {
    if (movement.type === "EARN") {
      if (isExpired(movement, now)) continue;
    }
    if (!Number.isSafeInteger(movement.pointsDelta)) {
      throw new Error("INVALID_POINTS_DELTA");
    }
    balance += movement.pointsDelta;
  }
  return Math.max(0, balance);
}

export interface RedemptionCheck {
  balance: number;
  pointsCost: number;
  rewardActive: boolean;
}

/**
 * Una redención es válida si la recompensa está activa y el saldo (no
 * vencido) cubre el costo en puntos.
 */
export function assertRedemptionAllowed(check: RedemptionCheck): void {
  if (!check.rewardActive) throw new Error("REWARD_INACTIVE");
  if (!Number.isSafeInteger(check.pointsCost) || check.pointsCost <= 0) {
    throw new Error("INVALID_POINTS_COST");
  }
  if (check.balance < check.pointsCost) {
    throw new Error("INSUFFICIENT_POINTS");
  }
}

/** expiresAt = occurredAt + expiryDays (ISO). */
export function loyaltyExpiresAt(occurredAt: string, expiryDays: number): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_OCCURRED_AT");
  date.setUTCDate(date.getUTCDate() + expiryDays);
  return date.toISOString();
}
