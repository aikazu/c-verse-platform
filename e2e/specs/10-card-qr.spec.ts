import { expect, type Page, test } from "@playwright/test";
import { clearMailbox, loginAs, userMenuLocator } from "../helpers";

/**
 * Flow F5 — QR fallback: rute grade QR `/cards/:cardId` (CardInfo.tsx).
 * QR pada kartu fisik / link berbagi membuka halaman ini TANPA flow 3D —
 * jadi konten inti harus render, bahkan untuk guest (cross-device).
 */

/** Buka /collection sebagai demo, ambil href kartu pertama (seed menjamin isi). */
async function getFirstCardHref(page: Page): Promise<string> {
  await loginAs(page, "demo@cverse.id");
  await page.goto("/collection");
  const cardLink = page.locator("a[href*='/cards/']").first();
  await expect(cardLink, "expected kartu koleksi milik demo@cverse.id di /collection (dijamin seeds/*.sql)").toBeVisible({
    timeout: 10000,
  });
  const href = await cardLink.getAttribute("href");
  if (!href) throw new Error("Link kartu /collection tanpa href");
  return href;
}

test.describe("Card QR fallback (/cards/:cardId)", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("halaman kartu render info inti via deep-link ala QR", async ({ page }) => {
    const cardHref = await getFirstCardHref(page);

    // Simulasi scan QR / buka link berbagi: deep-link LANGSUNG ke rute info.
    await page.goto(cardHref);
    await expect(page).toHaveURL(/\/cards\/[^/]+$/); // rute info — BUKAN /cards/:id/3d

    // Konten inti (CardInfo.tsx): nomor unit + variant, badge verifikasi,
    // judul drop — bukan sekadar "page loaded".
    await expect(page.locator(".ci-unit")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".ci-unit")).toContainText(/#\d+/);
    await expect(page.locator("text=/Terdaftar|Keaslian terverifikasi|Segel terdeteksi berubah/").first()).toBeVisible();
    await expect(page.locator(".ci-sub").first()).not.toHaveText("");

    // Ini halaman info QR-grade: menawarkan lanjut ke 3D, bukan merender 3D.
    await expect(page.locator("a[href*='/3d']")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });

  test("halaman kartu tetap render untuk guest (QR cross-device)", async ({ page }) => {
    const cardHref = await getFirstCardHref(page);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser fixture tidak tersedia");
    const context2 = await browser.newContext({ baseURL: "http://localhost:5173" });
    const page2 = await context2.newPage();
    try {
      await page2.goto(cardHref);
      // Rute kartu TIDAK dibungkus RequireAuth — QR dibuka siapa pun.
      await expect(page2.locator(".ci-unit")).toBeVisible({ timeout: 10000 });
      await expect(page2.locator(".ci-unit")).toContainText(/#\d+/);
      await expect(userMenuLocator(page2)).toHaveCount(0); // memang tanpa sesi
    } finally {
      await context2.close();
    }
  });
});
