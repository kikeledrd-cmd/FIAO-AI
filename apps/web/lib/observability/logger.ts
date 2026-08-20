const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d{10,15}/g;

/** Redacta PII en strings (emails y teléfonos), dejando números/longitudes intactas. */
export function redactPii(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactPii(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(entry);
    }
    return out;
  }
  return value;
}

function emit(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void {
  const safe = fields ? (redactValue(fields) as Record<string, unknown>) : undefined;
  const line = { ts: new Date().toISOString(), level, event, ...(safe ?? {}) };
  // JSON-lines a stdout; el runtime/collector de logs lo redirige.
  console.log(JSON.stringify(line));
}

export const logger = {
  info(event: string, fields?: Record<string, unknown>): void {
    emit("info", event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>): void {
    emit("warn", event, fields);
  },
  error(event: string, fields?: Record<string, unknown>): void {
    emit("error", event, fields);
  }
};
