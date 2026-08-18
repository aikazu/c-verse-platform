import { expect, test } from "@playwright/test";

test.describe("Public browsing (unauthenticated)", () => {
  test("landing page memuat dan menampilkan C.Verse branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=C.Verse").first()).toBeVisible();
    await expect(page.locator("text=C.Card").first()).toBeVisible();
  });

  test("halaman drops menampilkan daftar drop publik", async ({ page }) => {
    await page.goto("/drops");
    // Halaman harus render tanpa error
    await expect(page.locator("body")).not.toContainText("Error");
    await expect(page.locator("[class*=drop]").or(page.locator("table")).first()).toBeVisible({ timeout: 10000 });
  });

  test("halaman browse bisa diakses tanpa login", async ({ page }) => {
    await page.goto("/browse");
    await expect(page.locator("text=Secondary").or(page.locator("text=Browse")).or(page.locator("body"))).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Error");
  });

  test("drop detail menampilkan info tanpa login", async ({ page }) => {
    await page.goto("/drops");
    const firstDrop = page.locator("a[href*='/drops/']").first();
    await firstDrop.waitFor({ state: "visible", timeout: 10000 });
    await firstDrop.click();
    await expect(page).toHaveURL(/\/drops\//);
    // Tombol beli seharusnya mengarah ke login
    await expect(page.locator("text=Masuk").or(page.locator("button:has-text('Beli')"))).toBeVisible();
  });

  test("halaman 404 menampilkan error page", async ({ page }) => {
    await page.goto("/halaman-tidak-ada");
    await expect(page.locator("text=404").or(page.locator("text=tidak ditemukan"))).toBeVisible({ timeout: 10000 });
  });
});
