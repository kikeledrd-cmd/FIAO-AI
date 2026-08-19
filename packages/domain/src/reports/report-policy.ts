export const REPORT_LABELS = ["CONFIRMED", "ESTIMATED", "RECOMMENDATION"] as const;
export type ReportLabel = (typeof REPORT_LABELS)[number];

/** Inicio del día para proyecciones "hoy" (medianoche local del servidor). */
export function startOfDay(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Inicio de un período anterior de `days` días (para comparaciones). */
export function previousPeriodStart(now: Date = new Date(), days: number = 1): Date {
  const start = startOfDay(now);
  return new Date(start.getTime() - days * 24 * 3600 * 1000);
}

/** Variación porcentual entera (redondeo half-away-from-zero); null si no hay base. */
export function percentChange(currentCents: number, previousCents: number): number | null {
  if (!Number.isSafeInteger(currentCents) || !Number.isSafeInteger(previousCents) || previousCents === 0) {
    return null;
  }
  const delta = currentCents - previousCents;
  return Math.round((delta * 10000) / previousCents) / 100;
}

/** Ganancia estimada: subtotal − costo de promedio móvil (centavos). */
export function estimatedProfitCents(subtotalCents: number, costCents: number): number {
  return subtotalCents - costCents;
}

/** Convierte el label de ganancia: siempre ESTIMATED (costo promedio móvil). */
export function profitLabel(): ReportLabel {
  return "ESTIMATED";
}

/** Convierte un label de hecho vs recomendación según un umbral. */
export function stockLabel(available: number, threshold: number): ReportLabel {
  if (available <= 0) return "RECOMMENDATION";
  if (available <= threshold) return "ESTIMATED";
  return "CONFIRMED";
}
