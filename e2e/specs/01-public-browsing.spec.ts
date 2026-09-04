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
    // Tile drop = link detail (locator [class*=drop] rapuh — match kata
    // "backdrop" di nav-drawer-backdrop yang hidden).
    await expect(page.locator("a[href*='/drops/']").first()).toBeVisible({ timeout: 10000 });
  });

  test("halaman browse menampilkan grid tile per-drop tanpa login", async ({ page }) => {
    await page.goto("/browse");
    // Body saja (locator .or(body) → strict violation: body + link nav sama-sama match)
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Error");
    // Grid per-drop (B2): tile drop → klik → halaman drop.
    const dropTile = page.locator("a[href*='/drops/']").first();
    await dropTile.waitFor({ state: "visible", timeout: 10000 });
    await dropTile.click();
    await expect(page).toHaveURL(/\/drops\//);
  });

  test("drop detail menampilkan info tanpa login", async ({ page }) => {
    await page.goto("/drops");
    const firstDrop = page.locator("a[href*='/drops/']").first();
    await firstDrop.waitFor({ state: "visible", timeout: 10000 });
    await firstDrop.click();
    await expect(page).toHaveURL(/\/drops\//);
    // Jalur beli/masuk tampak untuk unauthenticated (.first(): "Masuk / Daftar"
    // dirender 2× — nav + drawer — dan tab "Beli Langsung" juga match "Beli").
    await expect(page.locator("text=Masuk").or(page.locator("button:has-text('Beli')")).first()).toBeVisible();
  });

  test("halaman 404 menampilkan error page", async ({ page }) => {
    await page.goto("/halaman-tidak-ada");
    // .first(): error page render 2 elemen match (span "404" + heading "tidak ditemukan")
    await expect(page.locator("text=404").or(page.locator("text=tidak ditemukan")).first()).toBeVisible({ timeout: 10000 });
  });

  test("pusat legal dan dokumen T&C dapat dibaca tanpa login", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByRole("heading", { name: "Pusat Legal", exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: /Syarat & Ketentuan/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
    await expect(page.getByRole("heading", { name: "Syarat & Ketentuan C.Verse" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "C-Coin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "C-Gems" })).toBeVisible();
    await expect(page.getByText("support@c-verse.co").first()).toBeVisible();
  });
});
