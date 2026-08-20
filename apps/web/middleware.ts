import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function reject(): NextResponse {
  return NextResponse.json({ error: "CSRF_REJECTED" }, { status: 403 });
}

/**
 * Protección CSRF para mutaciones state-changing basadas en cookie de sesión.
 * - Si hay header Origin, su host debe coincidir con el Host del request.
 * - Si hay Sec-Fetch-Site, debe ser same-origin/none/same-site (nunca cross-site).
 * El webhook de WhatsApp queda exento (server-to-server, validado por HMAC-SHA256).
 */
export function middleware(request: NextRequest): NextResponse {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();
  if (request.nextUrl.pathname === "/api/whatsapp/webhook") return NextResponse.next();

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) return reject();
    } catch {
      return reject();
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none" && fetchSite !== "same-site") {
    return reject();
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*"
};
