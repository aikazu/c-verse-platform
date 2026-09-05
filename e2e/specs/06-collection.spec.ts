import { expect, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

test.describe("Collection & NFC", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("card detail page bisa diakses", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/collection");
    const cardLink = page.locator("a[href*='/cards/']").first();
    // Seed menjamin demo@cverse.id punya kartu koleksi (seeds/*.sql) → hard assert.
    await expect(cardLink, "expected kartu koleksi milik demo@cverse.id di /collection (dijamin seeds/*.sql)").toBeVisible({
      timeout: 10000,
    });
    await cardLink.click();
    await expect(page).toHaveURL(/\/cards\//);
    // Detail harus memuat identitas kartu hasil navigasi koleksi, bukan hanya
    // berhasil mengganti URL.
    await expect(page.locator(".ci-unit")).toContainText(/#\d+/, { timeout: 10000 });
  });

  test("3D viewer memuat canvas", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await loginAs(page, "demo@cverse.id");
    await page.goto("/collection");
    const cardLink = page.locator("a[href*='/cards/']").first();
    // Seed menjamin demo punya kartu (sama dengan test "card detail page").
    await expect(cardLink).toBeVisible({ timeout: 10000 });
    await cardLink.click();
    await expect(page).toHaveURL(/\/cards\//);

    // Link "Lihat 3D" ada di DETAIL kartu (CardInfo.tsx .ci-view-3d), bukan di
    // grid /collection — jalur navigasi yang benar: collection → card → 3d.
    const view3d = page.locator(".ci-view-3d");
    await expect(view3d).toBeVisible({ timeout: 10000 });
    await view3d.click();
    await expect(page).toHaveURL(/\/3d$/);

    // Canvas Three.js (WebGLRenderer di-mount ke .c3d-canvas oleh viewer.ts).
    // Headless chromium memakai SwiftShader → cukup assert elemen canvas +
    // nol pageerror, BUKAN output piksel render.
    await expect(page.locator(".c3d-canvas canvas").first()).toBeVisible({ timeout: 15000 });
    expect(pageErrors, `halaman /3d tidak boleh melempar pageerror: ${pageErrors.map((e) => e.message).join("; ")}`).toEqual([]);
  });
});
