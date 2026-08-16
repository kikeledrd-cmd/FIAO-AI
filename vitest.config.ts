import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webRoot = fileURLToPath(new URL("./apps/web", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
          environment: "node"
        },
        resolve: {
          alias: {
            "@": webRoot
          }
        }
      },
      {
        test: {
          name: "component",
          include: ["apps/**/*.test.tsx"],
          exclude: ["**/*.integration.test.tsx", "**/node_modules/**"],
          environment: "jsdom",
          setupFiles: ["./apps/web/vitest.setup.ts"]
        },
        oxc: {
          jsx: {
            runtime: "automatic"
          }
        },
        resolve: {
          alias: {
            "@": webRoot
          }
        }
      },
      {
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts", "**/*.integration.test.tsx"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000
        },
        resolve: {
          alias: {
            "@": webRoot
          }
        }
      }
    ]
  }
});
