import { expect, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

test.describe("Wallet", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("wallet page menampilkan saldo dan histori", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    await expect(page.locator("[class*=balance]").first()).toBeVisible({ timeout: 10000 });
    // .first(): "Riwayat" (judul toolbar) + <table> sama-sama match → strict violation
    await expect(page.locator("text=Riwayat").or(page.locator("table")).or(page.locator("[class*=tx]")).first()).toBeVisible();
  });

  test("top-up inline di /wallet: blok Isi Saldo + pilihan nominal", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    // Top-up TIDAK lewat halaman terpisah — blok "Isi Saldo" inline di /wallet
    // (Wallet.tsx): title + select nominal + tombol "Isi N C →".
    await expect(page.locator("text=Isi Saldo").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('select[aria-label="Jumlah top-up C-Coin"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button[class*=wa-btn-block]")).toBeVisible();
  });

  test("payout gate: user non-kreator melihat pesan gate, bukan kontrol payout", async ({ page }) => {
    // Wallet.tsx:216-254 — blok payout ("Tarik ke Rekening" + tombol "Tarik")
    // HANYA render untuk role creator; untuk role lain selalu render pesan gate
    // "Penarikan hanya untuk kreator — KYC wajib." → bisa di-hard assert
    // (demo@cverse.id role user + KYC pending di seed.sql — deterministik).
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");

    // Pesan gate payout tampil (mengandung syarat KYC) — bukan `if (isVisible)`
    // yang bisa lulus tanpa menegaskan apa pun.
    await expect(page.locator("text=Penarikan hanya untuk kreator").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=KYC wajib").first()).toBeVisible();

    // Kontrol payout TIDAK boleh tampil untuk non-kreator.
    await expect(page.locator("text=Tarik ke Rekening")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tarik", exact: true })).toHaveCount(0);

    // Messaging gate non-KYC (demo KYC-nya pending): cap saldo 500 C-Coin tampil.
    await expect(page.locator("text=Cap saldo non-KYC").first()).toBeVisible();
    await expect(page.locator("text=500 C-Coin").first()).toBeVisible();
  });
});
