import { expect, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

test.describe("Secondary market", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("marketplace menampilkan halaman tanpa error", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/marketplace");
    await expect(page.locator("body")).not.toContainText("Error");
    // Jika ada listing tampilkan, jika tidak halaman tetap ok
    const count = await page.locator("[class*=card]").count();
    console.log(`Marketplace: ${count} item ditemukan`);
  });

  test("browse menampilkan grid tile per-drop", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/browse");
    // B2: /browse = grid tile per-drop (grid per-kartu pindah ke dalam halaman drop).
    await expect(page.locator("a[href*='/drops/']").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("Error");
  });

  test("place bid pada kartu milik user lain (rival@cverse.id)", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");

    // Seed menjamin target bid-able milik user LAIN: card-aespa-live-02 (AESL-002,
    // status 'bound', owner rival@cverse.id — bukan demo). B2: /browse kini
    // per-drop, jadi kartu dibuka langsung via URL detail.
    await page.goto("/cards/card-aespa-live-02");
    await expect(page).toHaveURL(/\/cards\/card-aespa-live-02/);

    // Form bid hanya render untuk non-owner (CardInfo.tsx: user && !isOwnerDerived).
    const bidInput = page.locator('input[aria-label="Jumlah tawaran C-Coin"]');
    await expect(bidInput).toBeVisible({ timeout: 10000 });

    // Idempoten antar-run: bid aktif sisa run sebelumnya (jika run sebelumnya
    // crash sebelum cleanup) dibatalkan dulu — cancel_bid melepas escrow hold.
    // Toast difilter per-teks: toast sukses sebelumnya hidup 4 detik (TTL) sehingga
    // locator .toast-success polos bisa resolve >1 elemen (strict mode violation).
    // Cancel bid wajib lewat modal konfirmasi (D8, founder 2026-08-31) —
    // klik "Batalkan bid" buka dialog, lalu konfirmasi di dalam dialog.
    const cancelBtn = page.locator("button:has-text('Batalkan bid')");
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
      const cancelConfirm = page.locator(".cfm-card");
      await expect(cancelConfirm).toContainText("Batalkan bid");
      await cancelConfirm.locator("button:has-text('Batalkan bid')").click();
      await expect(page.locator(".toast-success").filter({ hasText: "Bid dibatalkan" })).toBeVisible();
      await expect(cancelBtn).toBeHidden();
    }

    // Place bid 5 C → modal konfirmasi (useConfirm, wajib untuk aksi spend) →
    // place_bid RPC menahan C-Coin (escrow_hold) → toast sukses + panel "BID KAMU".
    await bidInput.fill("5");
    await page.locator("button:has-text('Tawar')").first().click();
    const confirmModal = page.locator(".cfm-card");
    await expect(confirmModal).toContainText("Tawar 5 C?");
    await confirmModal.locator("button:has-text('Tawar')").click();
    await expect(page.locator(".toast-success").filter({ hasText: "Penawaran 5 C terkirim" })).toBeVisible();

    const bidPanel = page.locator(".ci-bid-panel");
    await expect(bidPanel).toContainText("BID KAMU");
    await expect(bidPanel).toContainText("5 C");

    // Cleanup: batalkan bid agar state seed kembali bersih (saldo demo ter-refund,
    // slot bid aktif demo tidak naik) — sekaligus menguji cancel_bid RPC via
    // modal konfirmasi (D8).
    await page.locator("button:has-text('Batalkan bid')").click();
    const cancelConfirm = page.locator(".cfm-card");
    await expect(cancelConfirm).toContainText("Batalkan bid");
    await cancelConfirm.locator("button:has-text('Batalkan bid')").click();
    await expect(page.locator(".toast-success").filter({ hasText: "Bid dibatalkan" })).toBeVisible();
    await expect(page.locator(".ci-bid-panel")).toBeHidden();
  });
});
