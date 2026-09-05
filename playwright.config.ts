import { defineConfig } from "@playwright/test";
import { appServerEnv, browserEnv, localAppOrigins, reuseExistingServers } from "./e2e/env";

const origins = localAppOrigins();
const apiEnv = appServerEnv();
const browserRuntimeEnv = browserEnv(origins.api);
const reuseServer = reuseExistingServers();

/**
 * Config HARUS di root: Playwright hanya mencari playwright.config.* di cwd,
 * dan `pnpm exec playwright test` (script test:e2e + CI "Run E2E") jalan dari
 * root — config di e2e/ tidak pernah ketemu (testDir default = cwd, jadi
 * file vitest di apps/ ikut termuat → 0 tests). Dari root, testDir di bawah
 * ini menunjuk e2e/specs saja.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // sequential karena shared Supabase state
  // CI: github annotations + html report (folder artifact upload "playwright-report").
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]]
    : [["html", { outputFolder: "e2e/playwright-report", open: "never" }]],
  use: {
    baseURL: origins.web,
    trace: process.env.CI ? "on-first-retry" : "on",
    screenshot: "only-on-failure",
  },
  // Database tetap remote; yang dijalankan hanya tiga aplikasi lokal.
  // Reuse perlu opt-in agar endpoint lama dengan konfigurasi database berbeda
  // tidak diam-diam dipakai.
  webServer: [
    {
      command: "pnpm --filter @c-verse/api dev:node",
      url: `${origins.api}/health`,
      reuseExistingServer: reuseServer,
      env: { ...apiEnv, PORT: new URL(origins.api).port },
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @c-verse/web dev",
      url: origins.web,
      reuseExistingServer: reuseServer,
      env: browserRuntimeEnv,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @c-verse/admin dev",
      url: origins.admin,
      reuseExistingServer: reuseServer,
      env: browserRuntimeEnv,
      timeout: 120_000,
    },
  ],
  globalSetup: "./e2e/global-setup",
  projects: [
    // testIgnore: admin specs dimiliki project `admin` saja — tanpa ini
    // admin specs jalan 2× (sekali dengan baseURL web yang salah).
    { name: "web", testMatch: "**/*.spec.ts", testIgnore: "**/admin/**", use: { baseURL: origins.web } },
    { name: "admin", testMatch: "**/admin/*.spec.ts", use: { baseURL: origins.admin } },
  ],
});
