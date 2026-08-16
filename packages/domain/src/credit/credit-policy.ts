import type { CreditMovementType } from "@fiao/contracts/credit";

export interface CreditMovementInput {
  type: CreditMovementType | (string & {});
  amountCents: number;
  occurredAt?: string;
}

export interface FiaoScoreInput {
  total: number;
  onTime: number;
}

export interface FiaoScore {
  score: number;
  total: number;
  onTime: number;
  late: number;
  explanation: string;
}

/** Convierte un monto decimal ("100.50") a centavos enteros. */
export function parseMoneyCents(value: string): number {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("INVALID_AMOUNT");
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n) throw new Error("INVALID_AMOUNT");
  return Number(cents);
}

/**
 * Saldo del cliente = Σ FIAO_SALE − Σ ABONO.
 * El saldo nunca se persiste como campo: se reconstruye desde movimientos.
 */
export function creditBalanceCents(movements: CreditMovementInput[]): number {
  let balance = 0n;
  for (const movement of movements) {
    const amount = BigInt(movement.amountCents);
    if (amount <= 0n) throw new Error("INVALID_CREDIT_MOVEMENT");
    if (movement.type === "FIAO_SALE") balance += amount;
    else if (movement.type === "ABONO") balance -= amount;
    else throw new Error("UNKNOWN_CREDIT_MOVEMENT");
  }
  if (balance < 0n) throw new Error("NEGATIVE_CREDIT_BALANCE");
  if (balance > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CREDIT_BALANCE_OVERFLOW");
  return Number(balance);
}

/** Valida que el nuevo saldo (balance + fiado) no exceda el límite. */
export function assertCreditLimit(currentBalanceCents: number, fiadoCents: number, creditLimitCents: number): void {
  if (currentBalanceCents + fiadoCents > creditLimitCents) throw new Error("CREDIT_LIMIT_EXCEEDED");
}

/** Valida que un abono no supere el saldo actual. */
export function assertAbonoValid(currentBalanceCents: number, abonoCents: number): void {
  if (abonoCents > currentBalanceCents) throw new Error("ABONO_EXCEEDS_BALANCE");
}

/**
 * FIAO Score v1 (explicable).
 * Base 100; cada abono tardío penaliza la proporción 100 × tardíos / total.
 * Sin historial → 100 (neutral). El resultado expone total/onTime/late para
 * que la UI explique el cálculo.
 */
export function computeFiaoScore(input: FiaoScoreInput): FiaoScore {
  const total = input.total;
  const onTime = input.onTime;
  if (total < 0 || onTime < 0 || onTime > total) throw new Error("INVALID_SCORE_INPUT");
  if (total === 0) {
    return { score: 100, total: 0, onTime: 0, late: 0, explanation: "Sin historial de crédito: puntuación neutra (100)." };
  }
  const late = total - onTime;
  const score = Math.floor((100 * onTime) / total);
  return {
    score,
    total,
    onTime,
    late,
    explanation: `${onTime} de ${total} abonos a tiempo${late > 0 ? `, ${late} tardío(s)` : ""}: ${score}/100.`
  };
}
