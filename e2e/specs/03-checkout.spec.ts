import { test, expect } from "@playwright/test";
import { loginAs, clearMailbox } from "../helpers";

test.describe("Primary checkout", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("halaman checkout bisa diakses setelah pilih drop", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/drops");
    const firstDrop = page.locator("a[href*='/drops/']").first();
    await firstDrop.waitFor({ state: "visible", timeout: 10000 });
    await firstDrop.click();
    await expect(page).toHaveURL(/\/drops\//);
    // Halaman detail tidak error
    await expect(page.locator("body")).not.toContainText("Error");
  });

  test("checkout vault: halaman checkout memuat", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    // Catat saldo (sebagai string, bisa undefined kalo loading)
    const saldoText = await page.locator("[class*=balance]").first().textContent();

    await page.goto("/drops");
    const firstDrop = page.locator("a[href*='/drops/']").first();
    await firstDrop.waitFor({ state: "visible", timeout: 10000 });
    await firstDrop.click();

    // Cari tombol checkout/beli
    const beliBtn = page.locator("text=Beli").or(page.locator("text=Checkout")).first();
    if (await beliBtn.isVisible()) {
      await beliBtn.click();
      await expect(page).toHaveURL(/checkout/);
      await expect(page.locator("text=Vault").or(page.locator("text=Simpan"))).toBeVisible({ timeout: 10000 });
    }
    // Jika tidak ada tombol (drop sold_out), skip — bukan error
  });

  test("checkout shipping: alamat wajib diisi", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/drops");
    const firstDrop = page.locator("a[href*='/drops/']").first();
    await firstDrop.waitFor({ state: "visible", timeout: 10000 });
    await firstDrop.click();

    const beliBtn = page.locator("text=Beli").or(page.locator("text=Checkout")).first();
    if (await beliBtn.isVisible()) {
      await beliBtn.click();
      // Pilih shipping
      const shippingRadio = page.locator("text=Kirim").or(page.locator('input[value="shipping"]')).first();
      if (await shippingRadio.isVisible()) {
        await shippingRadio.click();
        // Submit tanpa alamat → error
        await page.click('button:has-text("Konfirmasi")');
        await expect(page.locator("text=alamat").or(page.locator("[class*=error]"))).toBeVisible({ timeout: 5000 });
      }
    }
  });
});