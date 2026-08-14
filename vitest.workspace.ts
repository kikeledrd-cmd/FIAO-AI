import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
      exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
      environment: "node"
    }
  },
  {
    test: {
      name: "integration",
      include: ["**/*.integration.test.ts", "**/*.integration.test.tsx"],
      environment: "node",
      testTimeout: 30_000,
      hookTimeout: 30_000
    }
  }
]);
