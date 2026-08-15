import { defineConfig } from "vitest/config";

// Spec 15 §2: workspace projects = packages/shared + apps/api (web/admin smoke manual Y1).
export default defineConfig({
  test: {
    projects: ["packages/shared", "apps/api"],
  },
});
