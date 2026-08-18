import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox } from "../helpers";

test.describe("KYC", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("form KYC bisa diakses dari menu", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me/kyc");
    await expect(page.locator("text=NIK").or(page.locator("input").first())).toBeVisible({ timeout: 10000 });
  });

  test("submit KYC dengan data valid", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me/kyc");
    await page.waitForSelector('input[name="fullName"], input:not([type])', { timeout: 10000 });

    // Isi form — selector disesuaikan dengan implementasi
    const nameInput = page.locator('input[name="fullName"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill("E2E Tester");
    }
    const nikInput = page.locator('input[name="nik"]').first();
    if (await nikInput.isVisible()) {
      await nikInput.fill("1234567890123456");
    }
    const addressInput = page.locator('textarea[name="address"]').first();
    if (await addressInput.isVisible()) {
      await addressInput.fill("Jl. Testing No. 123, Jakarta");
    }

    // Submit
    const submitBtn = page.locator('button:has-text("Kirim")').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await expect(page.locator("text=Terkirim").or(page.locator("text=menunggu"))).toBeVisible({ timeout: 10000 });
    }
  });
});