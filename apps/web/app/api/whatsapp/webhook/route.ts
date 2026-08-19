import { NextResponse } from "next/server";
import { ingestWhatsAppMessage } from "@/lib/whatsapp/ingest";
import { extractInboundText, verifyWebhookSignature } from "@/lib/whatsapp/verify";

export const runtime = "nodejs";

function appSecret(): string {
  return process.env.WHATSAPP_APP_SECRET ?? "";
}

function verifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN ?? "fiao-dev-token";
}

/**
 * GET: verificación de webhook de Meta (hub.challenge).
 * Meta espera que se devuelva el challenge tal cual cuando el token coincide.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken() && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}

/**
 * POST: mensajes entrantes de WhatsApp. Valida la firma X-Hub-Signature-256
 * (cuando hay app secret) y normaliza el primer mensaje de texto a un pedido.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const secret = appSecret();
  if (secret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const message = extractInboundText(body);
  if (!message) {
    return NextResponse.json({ ok: true, result: { status: "NO_ITEMS" } });
  }

  const result = await ingestWhatsAppMessage(message.text, message.fromPhoneE164);
  return NextResponse.json({ ok: true, result });
}
