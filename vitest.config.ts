import { defineConfig } from "vitest/config";

// Workspace projects keep pure-logic tests in Node; web has no DOM test harness.
export default defineConfig({
  test: {
    projects: ["packages/shared", "apps/api", "apps/admin", "apps/web", "scripts/discord"],
  },
});
