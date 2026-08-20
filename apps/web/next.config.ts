import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

loadEnv({ path: new URL("../../.env", import.meta.url) });
loadEnv();

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  register: true
});

const nextConfig: NextConfig = {
  typedRoutes: true,
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" }
    ];
    const production = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'"
        ].join("; ")
      }
    ];
    const headers = process.env.NODE_ENV === "production" ? [...base, ...production] : base;
    return [{ source: "/:path*", headers }];
  }
};

export default withSerwist(nextConfig);
