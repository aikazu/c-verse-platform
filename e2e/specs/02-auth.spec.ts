import { expect, test } from "@playwright/test";
import { clearMailbox, getMagicLinkFromMailpit, isOtpPathAvailable, loginAs, toLocalOrigin, userMenuLocator } from "../helpers";

const TEST_EMAIL = `e2e-${Date.now()}@test.cverse.id`;

test.describe("Authentication", () => {
  test.afterAll(async () => {
    await clearMailbox(TEST_EMAIL);
  });

  test("register user baru via email OTP", async ({ page }) => {
    test.skip(
      !(await isOtpPathAvailable(page)),
      "Turnstile tidak menerbitkan token di bench ini (tombol kirim OTP selamanya disabled) — jalur OTP butuh server web dengan site key valid untuk localhost",
    );
    await page.goto("/register");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', TEST_EMAIL);
    // Display name opsional — AuthForm memakai id (#auth-displayname), bukan name attr
    const nameInput = page.locator("#auth-displayname");
    if (await nameInput.isVisible()) {
      await nameInput.fill("E2E Tester");
    }
    // Submit = "Kirim kode OTP (email)". BUKAN has-text("Daftar") — itu cuma
    // match tombol nav "MASUK / DAFTAR" (penyebab register lama tak pernah
    // mengirim email: klik mendarat di nav, form tidak submit).
    await page.click('button:has-text("Kirim kode masuk ke email")');

    // GoTrue lokal mengirim MAGIC LINK untuk user baru juga (probe 2026-08-29:
    // POST /auth/v1/otp create_user=true → email "Your sign-in link", respons
    // {} tanpa sesi) → selesaikan lewat link Mailpit.
    const magicLink = await getMagicLinkFromMailpit(TEST_EMAIL);
    await page.goto(toLocalOrigin(magicLink));
    await expect(userMenuLocator(page)).toBeVisible({ timeout: 15000 });
  });

  test("login sebagai demo@cverse.id", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    // Verifikasi user menu muncul
    await expect(userMenuLocator(page)).toBeVisible({ timeout: 10000 });
  });

  test("logout berhasil", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    // Klik menu user → logout
    const menuBtn = userMenuLocator(page);
    await menuBtn.waitFor({ state: "visible", timeout: 10000 });
    await menuBtn.click();
    await page.click("text=Keluar");
    await expect(page.locator("text=Masuk").first()).toBeVisible({ timeout: 10000 });
  });

  test("magic link bekas (single-use) tidak membuat sesi di context baru", async ({ page }) => {
    test.skip(
      !(await isOtpPathAvailable(page)),
      "Turnstile tidak menerbitkan token di bench ini (tombol kirim OTP selamanya disabled) — jalur OTP butuh server web dengan site key valid untuk localhost",
    );
    // Jalani flow login manual untuk MENAHAN magic link yang sudah dipakai.
    await clearMailbox(TEST_EMAIL);
    await page.goto("/login");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.click('button:has-text("Kirim")');
    const magicLink = await getMagicLinkFromMailpit(TEST_EMAIL);
    const localLink = toLocalOrigin(magicLink);

    // Kunjungan PERTAMA → sesi sah (UserMenu tampil).
    await page.goto(localLink);
    await expect(userMenuLocator(page)).toBeVisible({ timeout: 15000 });

    // Kunjungan KEDUA pakai link yang sama di context BERSIH (storage kosong —
    // kalau di context lama, sesi lama masih ada dan pasti "login" false-pass).
    const browser = page.context().browser();
    if (!browser) throw new Error("browser fixture tidak tersedia");
    const context2 = await browser.newContext({ baseURL: "http://localhost:5173" });
    const page2 = await context2.newPage();
    try {
      await page2.goto(localLink);
      // GoTrue menolak token bekas → app render logged-out: nav "Masuk" tampil,
      // UserMenu TIDAK boleh ada (indikator sesi — helpers.ts).
      await expect(page2.locator("text=Masuk").first()).toBeVisible({ timeout: 15000 });
      await expect(userMenuLocator(page2)).toHaveCount(0);
    } finally {
      await context2.close();
    }
  });

  test("guest: /wallet dan /collection redirect ke login tanpa konten user", async ({ page }) => {
    // Context test baru = belum login. RequireAuth harus redirect, bukan crash.
    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await expect(userMenuLocator(page)).toHaveCount(0);

    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    // Tidak ada konten khusus user (saldo/kartu) — UserMenu absen adalah
    // indikator sesi yang pasti (helpers.ts).
    await expect(userMenuLocator(page)).toHaveCount(0);
  });
});
