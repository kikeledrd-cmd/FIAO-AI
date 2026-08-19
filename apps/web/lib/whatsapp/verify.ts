import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica la firma `X-Hub-Signature-256` de Meta (HMAC-SHA256 del body
 * crudo con el app secret). Comparación en tiempo constante.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length).trim();
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export interface InboundTextMessage {
  /** Remitente en E.164 ("+18095550123"). */
  fromPhoneE164: string;
  text: string;
}

/** Normaliza un número de Meta (sin "+") a E.164. */
export function toE164(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : value;
}

/**
 * Extrae el primer mensaje de texto entrante de un webhook de Meta
 * (entry → changes → value → messages). Devuelve null si no hay mensaje
 * de texto utilizable.
 */
export function extractInboundText(body: unknown): InboundTextMessage | null {
  if (typeof body !== "object" || body === null) return null;
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (typeof change !== "object" || change === null) continue;
      const value = (change as { value?: unknown }).value;
      if (typeof value !== "object" || value === null) continue;
      const messages = (value as { messages?: unknown }).messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (typeof message !== "object" || message === null) continue;
        const candidate = message as { from?: unknown; text?: unknown; type?: unknown };
        if (candidate.type !== "text") continue;
        if (typeof candidate.from !== "string") continue;
        const textBody = (candidate.text as { body?: unknown } | undefined)?.body;
        if (typeof textBody !== "string" || textBody.trim().length === 0) continue;
        return { fromPhoneE164: toE164(candidate.from), text: textBody.trim() };
      }
    }
  }
  return null;
}
