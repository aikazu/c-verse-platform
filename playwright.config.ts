import { defineConfig } from "@playwright/test";

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
  reporter: process.env.CI ? [["github"]] : [["html", { outputFolder: "e2e/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: process.env.CI ? "on-first-retry" : "on",
    screenshot: "only-on-failure",
  },
  // Auto-start (CI / mesin kosong) atau reuse server yang sudah jalan (lokal).
  webServer: [
    {
      command: "pnpm --filter @c-verse/api dev:node",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @c-verse/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      env: buildWebServerEnv(),
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @c-verse/admin dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  globalSetup: "./e2e/global-setup",
  projects: [
    // testIgnore: admin specs dimiliki project `admin` saja — tanpa ini
    // admin specs jalan 2× (sekali dengan baseURL web yang salah).
    { name: "web", testMatch: "**/*.spec.ts", testIgnore: "**/admin/**", use: { baseURL: "http://localhost:5173" } },
    { name: "admin", testMatch: "**/admin/*.spec.ts", use: { baseURL: "http://localhost:3000" } },
  ],
});

/**
 * Env untuk server yang di-start Playwright sendiri: turunkan seluruh
 * process.env lalu matikan Turnstile via site key kosong (no-op — lihat
 * apps/web/src/lib/turnstile.ts: isTurnstileEnabled = SITE_KEY.length > 0).
 * Supresi ini HANYA berlaku untuk server yang Playwright start; file
 * .env* milik owner tidak pernah disentuh.
 */
function buildWebServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.VITE_TURNSTILE_SITE_KEY = "";
  return env;
}
