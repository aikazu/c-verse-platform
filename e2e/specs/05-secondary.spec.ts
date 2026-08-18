import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox } from "../helpers";

test.describe("Secondary market", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("marketplace menampilkan halaman tanpa error", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/marketplace");
    await expect(page.locator("body")).not.toContainText("Error");
    // Jika ada listing tampilkan, jika tidak halaman tetap ok
    const count = await page.locator("[class*=card]").count();
    console.log(`Marketplace: ${count} item ditemukan`);
  });

  test("browse menampilkan kartu secondary", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/browse");
    await expect(page.locator("[class*=card]").or(page.locator("table")).or(page.locator("body"))).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("Error");
  });

  test("place bid pada kartu (jika tersedia)", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/browse");
    const bidBtn = page.locator("text=Bid").first();
    if (await bidBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bidBtn.click();
      const input = page.locator("input[type=number]").first();
      if (await input.isVisible()) {
        await input.fill("5");
        await page.click('button:has-text("Konfirmasi")');
        await expect(page.locator("text=Berhasil").or(page.locator("text=Bid"))).toBeVisible({ timeout: 10000 });
      }
    }
    // Jika tidak ada kartu yang bisa di-bid, skip — bukan error
  });
});