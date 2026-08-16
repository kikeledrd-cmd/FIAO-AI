import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "android-chromium",
      use: { ...devices["Pixel 7"] }
    }
  ],
  webServer: {
    // The offline shell test requires the production service worker
    // (dev mode uses NetworkOnly for everything), so E2E runs against
    // `next build && next start`.
    command: "pnpm --filter @fiao/web build && pnpm --filter @fiao/web start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
