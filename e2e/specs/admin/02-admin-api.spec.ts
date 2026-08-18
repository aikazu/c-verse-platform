import { test, expect } from "@playwright/test";

test.describe("Admin drops (API)", () => {
  test("API drops endpoint bisa diakses", async ({ page }) => {
    const res = await page.request.get("http://localhost:8787/api/drops");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.drops).toBeDefined();
    expect(Array.isArray(body.drops)).toBeTruthy();
  });

  test("API health endpoint ok", async ({ page }) => {
    const res = await page.request.get("http://localhost:8787/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});