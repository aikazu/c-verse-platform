import { expect, test } from "@playwright/test";

const documents = ["terms", "privacy", "shipping", "kyc", "creator-terms"];

test.describe("Public legal documents", () => {
  for (const width of [1280, 390]) {
    for (const slug of documents) {
      test(`${slug} stays readable and keeps internal planning out at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/legal/${slug}`);
        await expect(page.locator(".legal-document")).toBeVisible();
        await expect(page.locator(".legal-shell")).not.toContainText(
          /\bMVP\b|\bY[12]\b|100[.,]000\s*(followers|pengikut)|Cloudflare Access|WARP|konstanta server|Threshold operasional/i,
        );
        // Draft status and missing operator details are intentional until supplied.
        await expect(page.locator(".legal-meta-grid")).toContainText(/Final internal|Draft publikasi|Draft kontrak/);
        await expect(page.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
        const printBounds = await page.getByRole("button", { name: "Cetak / Simpan PDF" }).boundingBox();
        expect(printBounds).not.toBeNull();
        expect((printBounds?.x ?? 0) + (printBounds?.width ?? 0)).toBeLessThanOrEqual(width);
        const layout = await page.evaluate(() => {
          const ids = [...document.querySelectorAll(".legal-shell [id]")].map((element) => element.id);
          return { uniqueIds: new Set(ids).size === ids.length, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(layout).toEqual({ uniqueIds: true, overflow: false });
        for (const link of await page.locator('.legal-toc a[href^="#"]').all()) {
          const href = await link.getAttribute("href");
          expect(href).toBeTruthy();
          await expect(page.locator(href as string)).toHaveCount(1);
        }
        await page.getByRole("link", { name: "Sumber hukum", exact: true }).click();
        await expect(page).toHaveURL(/#sumber-hukum$/);
        await expect(page.locator("#sumber-hukum")).toBeInViewport();
        await page.emulateMedia({ media: "print" });
        await expect(page.locator(".legal-document")).toBeVisible();
        await expect(page.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeHidden();
      });
    }
  }

  test("financial limits, QR caveat, and missing operator identity remain explicit", async ({ page }) => {
    await page.goto("/legal/terms");
    await expect(page.locator("#c-gems")).toContainText("dibulatkan ke atas ke C-Gems utuh");
    await expect(page.locator("#c-gems")).toContainText("Rp90.000");
    await expect(page.locator("#c-gems")).toContainText("Penukaran tidak dapat dibatalkan");
    await expect(page.locator("#c-coin")).toContainText("saldo setelah pengisian tidak melebihi 500 C-Coin");
    await expect(page.locator("#nfc")).toContainText("Kode QR membuka informasi kartu dan tidak membuktikan keaslian");
    await expect(page.locator("#operator")).toContainText("Akan diisi sebelum publikasi komersial");
    await expect(page.locator("#tanggung-jawab")).toContainText("hak konsumen yang tidak dapat dikesampingkan");
    await expect(page.locator("#sumber-hukum")).not.toContainText("20/6/PBI/2018");
  });

  test("privacy data sources and legal sources have separate anchors", async ({ page }) => {
    await page.goto("/legal/privacy");
    await page.getByRole("link", { name: "3. Sumber Data", exact: true }).click();
    await expect(page).toHaveURL(/#sumber$/);
    await expect(page.locator("#sumber")).toContainText("Dari Google");
    await page.getByRole("link", { name: "Sumber hukum", exact: true }).click();
    await expect(page).toHaveURL(/#sumber-hukum$/);
    await expect(page.locator("#sumber-hukum")).toContainText("Pelindungan Data Pribadi");
  });
});
