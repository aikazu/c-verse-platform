import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox, getOtpFromInbucket } from "../helpers";

const TEST_EMAIL = `e2e-${Date.now()}@test.cverse.id`;

test.describe("Authentication", () => {
  test.afterAll(async () => {
    await clearMailbox(TEST_EMAIL);
  });

  test("register user baru via email OTP", async ({ page }) => {
    await page.goto("/register");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', TEST_EMAIL);
    // Isi display name jika ada
    const nameInput = page.locator('input[name="displayName"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill("E2E Tester");
    }
    await page.click('button:has-text("Daftar")');

    // OTP terkirim ke Inbucket
    const otp = await getOtpFromInbucket(TEST_EMAIL);
    await page.fill('input[inputmode="numeric"]', otp);
    await page.click('button:has-text("Verifikasi")');

    // Harusnya masuk ke halaman utama
    await expect(page.locator("text=Koleksi").or(page.locator("[class*=user-menu]")).first()).toBeVisible({ timeout: 15000 });
  });

  test("login sebagai demo@cverse.id", async ({ page }) => {
    await clearMailbox("demo@cverse.id");
    await loginAs(page, "demo@cverse.id");
    // Verifikasi user menu muncul
    await expect(page.locator("[class*=user-menu], [aria-haspopup=menu]").first()).toBeVisible({ timeout: 10000 });
  });

  test("logout berhasil", async ({ page }) => {
    await clearMailbox("demo@cverse.id");
    await loginAs(page, "demo@cverse.id");
    // Klik menu user → logout
    const menuBtn = page.locator("[aria-haspopup=menu]").first();
    await menuBtn.waitFor({ state: "visible", timeout: 10000 });
    await menuBtn.click();
    await page.click("text=Keluar");
    await expect(page.locator("text=Masuk").first()).toBeVisible({ timeout: 10000 });
  });
});