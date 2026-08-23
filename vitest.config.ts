import { defineConfig } from "vitest/config";

// Spec 15 §2: workspace projects = packages/shared + apps/api + apps/admin.
// Admin coverage = pure-logic tests only (no DOM, no testing-library).
export default defineConfig({
  test: {
    projects: ["packages/shared", "apps/api", "apps/admin"],
  },
});
