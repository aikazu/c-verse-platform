import { expect, test } from "@playwright/test";
import { loginAs } from "../helpers";

for (const width of [1280, 390]) {
  test(`public page headings and navigation remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, title] of [
      ["/drops", "Drops"],
      ["/marketplace", "Marketplace"],
      ["/browse", "Jelajahi"],
      ["/leaderboard", "Peringkat"],
    ]) {
      await page.goto(path);
      const heading = page.getByRole("heading", { level: 1, name: title, exact: true });
      await expect(heading).toBeVisible();
      // A clipped, screen-reader-only heading is technically visible to Playwright.
      // Assert its rendered height so page identity also reaches sighted users.
      await expect.poll(async () => (await heading.boundingBox())?.height ?? 0).toBeGreaterThan(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
    }
    const dropLink = page.getByRole("link", { name: "Drops", exact: true });
    if (width < 720) await page.getByRole("button", { name: "Buka menu navigasi" }).click();
    await dropLink.filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/drops$/);
  });
}

test("landing links to drops and legal documents without requiring login", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "C.Card" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("landing-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Lihat Drops", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Drops" })).toBeVisible();
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1, name: "C.Card" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("landing-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Ketentuan Vault" }).click();
  await expect(page).toHaveURL(/\/legal\/shipping$/);
  await expect(page.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("legal-mobile.png"), fullPage: true });
});

test("register remains an alias for the same working login form", async ({ page }) => {
  await page.goto("/register");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Masuk / Daftar" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("demo@cverse.id");
  await expect(page.getByRole("button", { name: /Kirim/ })).toBeEnabled();
});

test("collector screens retain visible page identity on mobile", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await loginAs(page, "demo@cverse.id");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/home", "/collection", "/wallet", "/orders", "/notifications", "/me/privacy"]) {
    await page.goto(path);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect.poll(async () => (await heading.boundingBox())?.height ?? 0).toBeGreaterThan(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll("/", "-")}-mobile.png`), fullPage: true });
  }
});
