import { expect, test } from "@playwright/test";
import { loginAs, userMenuLocator } from "../helpers";

test.describe("Authentication", () => {
  test("form OTP tersedia tanpa memanggil provider pada harness remote", async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: "limitation",
      description:
        "Provider email OTP nyata dan tautan satu-pakai tidak diuji: harness remote sengaja tidak mengirim email atau membuat akun. Sesi fixture diprovisikan server-side.",
    });
    let otpRequests = 0;
    await page.route("**/auth/v1/otp", async (route) => {
      otpRequests += 1;
      await route.abort();
    });

    await page.goto("/login");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kirim kode masuk ke email" })).toBeVisible();
    expect(otpRequests, "merender form tidak boleh mengirim OTP").toBe(0);
  });

  test("login fixture memuat state aplikasi terautentikasi", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await expect(userMenuLocator(page)).toBeVisible({ timeout: 10_000 });
  });

  test("callback OAuth mock memulihkan continuation lokal setelah sesi fixture siap", async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "cverse_oauth_continuation_v1",
        JSON.stringify({ path: "/drops/drop-aespa-live-02?pool=premium", createdAt: Date.now() }),
      );
    });
    // Sesi dibuat langsung oleh harness. Tidak ada request ke Google; ini
    // menguji callback browser yang mengonsumsi continuation sesudah profile load.
    await loginAs(page, "demo@cverse.id");
    await expect(page).toHaveURL(/\/drops\/drop-aespa-live-02\?pool=premium/, { timeout: 10_000 });
    await expect(userMenuLocator(page)).toBeVisible();
    await expect(page.evaluate(() => sessionStorage.getItem("cverse_oauth_continuation_v1"))).resolves.toBeNull();
  });

  test("logout menghapus state sesi fixture", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    const menuBtn = userMenuLocator(page);
    await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
    await menuBtn.click();
    await page.click("text=Keluar");
    await expect(page.locator("text=Masuk").first()).toBeVisible({ timeout: 10_000 });
    await expect(userMenuLocator(page)).toHaveCount(0);
  });

  test("guest: /wallet dan /collection redirect ke login tanpa konten user", async ({ page }) => {
    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(userMenuLocator(page)).toHaveCount(0);

    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(userMenuLocator(page)).toHaveCount(0);
  });
});
