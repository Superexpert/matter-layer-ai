import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    exclude: [
      "node_modules/**",
      ".next/**",
      "playwright-report/**",
      "test-results/**",
      "tests/e2e/**",
    ],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "services/**/*.test.ts",
      "workflow-steps/**/*.test.ts",
      "lib/**/*.test.ts",
    ],
    globalSetup: ["tests/integration/global-setup.ts"],
  },
});
