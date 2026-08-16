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
  typedRoutes: true
};

export default withSerwist(nextConfig);
