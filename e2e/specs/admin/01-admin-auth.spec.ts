import { expect, test } from "@playwright/test";

test("admin login stays usable on desktop and mobile; boot failures fail the test", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("heading", { level: 1, name: "Masuk", exact: true })).toBeVisible();
    const email = page.getByLabel("Email", { exact: true });
    await email.fill("admin@cverse.id");
    await expect(email).toHaveValue("admin@cverse.id");
    await expect(page.getByRole("button", { name: "Kirim Tautan Masuk" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`admin-login-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
