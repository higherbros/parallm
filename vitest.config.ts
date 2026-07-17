import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 99,
        branches: 94,
        functions: 100,
        lines: 99,
      },
    },
  },
});
