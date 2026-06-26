import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
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
      "tests/integration/**",
    ],
    include: ["tests/unit/**/*.test.ts"],
  },
});
