import { defineConfig } from "vitest/config";

// Admin vitest: pure-logic tests only — no DOM (no @testing-library).
// The workspace projects list (vitest.config.ts at repo root) picks this up.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
