import { expect, test } from "@playwright/test";
import { localAppOrigins } from "../../env";

const API_BASE = localAppOrigins().api;

test.describe("Admin drops (API)", () => {
  test("API drops endpoint bisa diakses", async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/api/drops`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.drops).toBeDefined();
    expect(Array.isArray(body.drops)).toBeTruthy();
  });

  test("API health endpoint ok", async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
