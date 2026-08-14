export type MoneyCents = bigint;

const DOMINICAN_AREA_CODES = new Set(["809", "829", "849"]);

export function pesosToCents(input: string): MoneyCents {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input);
  if (!match) {
    throw new Error("INVALID_MONEY");
  }

  const whole = match[1]!;
  const fraction = match[2] ?? "";
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function centsToPesos(value: MoneyCents): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function normalizePhoneDO(raw: string): string {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) {
    throw new Error("INVALID_PHONE");
  }

  let digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (digits.length === 10) {
    digits = `1${digits}`;
  }

  if (digits.length !== 11 || digits[0] !== "1") {
    throw new Error("INVALID_PHONE");
  }

  const areaCode = digits.slice(1, 4);
  if (!DOMINICAN_AREA_CODES.has(areaCode)) {
    throw new Error("INVALID_PHONE");
  }

  return `+${digits}`;
}
