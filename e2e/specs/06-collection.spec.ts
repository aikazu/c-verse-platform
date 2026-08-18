import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox } from "../helpers";

test.describe("Collection & NFC", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("koleksi menampilkan halaman tanpa error", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/collection");
    await expect(page.locator("body")).not.toContainText("Error");
    const count = await page.locator("[class*=card]").count();
    console.log(`Koleksi: ${count} kartu ditemukan`);
  });

  test("card detail page bisa diakses", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/collection");
    const cardLink = page.locator("a[href*='/cards/']").first();
    if (await cardLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cardLink.click();
      await expect(page).toHaveURL(/\/cards\//);
      await expect(page.locator("body")).not.toContainText("Error");
    }
  });

  test("3D viewer memuat canvas", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/collection");
    const viewLink = page.locator("a[href*='/3d']").first();
    if (await viewLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewLink.click();
      await expect(page).toHaveURL(/\/3d/);
      // Canvas Three.js harus ada (mungkin butuh WebGL)
      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15000 });
    }
  });
});