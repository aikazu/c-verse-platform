import { test, expect } from "@playwright/test";

test.describe("Admin auth", () => {
  test("halaman login admin menampilkan form email", async ({ page }) => {
    await page.goto("http://localhost:3000");
    await expect(page.locator("text=Masuk").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("halaman login menampilkan branding C.Verse Admin", async ({ page }) => {
    await page.goto("http://localhost:3000");
    await expect(page.locator("text=C.Verse").or(page.locator("text=Admin"))).toBeVisible();
  });
});