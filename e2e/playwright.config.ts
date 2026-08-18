import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // sequential karena shared Supabase state
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: process.env.CI ? "on-first-retry" : "on",
    screenshot: "only-on-failure",
  },
  globalSetup: "./e2e/global-setup",
  projects: [
    { name: "web", testMatch: "**/*.spec.ts", use: { baseURL: "http://localhost:5173" } },
    { name: "admin", testMatch: "**/admin/*.spec.ts", use: { baseURL: "http://localhost:3000" } },
  ],
});