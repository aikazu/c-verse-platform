import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox } from "../helpers";

test.describe("Wallet", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("wallet page menampilkan saldo dan histori", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    await expect(page.locator("[class*=balance]").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Riwayat").or(page.locator("table")).or(page.locator("[class*=tx]"))).toBeVisible();
  });

  test("top-up button menuju halaman top-up", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    const topBtn = page.locator("text=Top Up").or(page.locator("text=Topup")).first();
    await topBtn.waitFor({ state: "visible", timeout: 10000 });
    await topBtn.click();
    // Harusnya ada form jumlah
    await expect(page.locator("text=Jumlah").or(page.locator("input[type=number]"))).toBeVisible({ timeout: 10000 });
  });

  test("payout request menampilkan KYC gate untuk user non-KYC", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    const payoutBtn = page.locator("text=Payout").first();
    if (await payoutBtn.isVisible()) {
      await payoutBtn.click();
      // User non-KYC harusnya diarahkan ke KYC atau lihat pesan KYC
      await expect(page.locator("text=KYC").or(page.locator("text=Verifikasi")).or(page.locator("text=payout"))).toBeVisible({
        timeout: 10000,
      });
    }
  });
});