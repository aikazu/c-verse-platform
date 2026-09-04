import { expect, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";
import { backdateActiveBids, isDbFixtureAvailable } from "../helpers/db";

// Cooldown cancel bid 24 jam (founder 2026-09-01): bid segar TIDAK bisa
// dibatalkan lewat UI (tombol disabled + info "Bisa dibatalkan …"). Untuk
// cancel via UI, `created_at` bid di-backdate dulu langsung di DB lokal
// (service role — e2e/helpers/db.ts) supaya cooldown dianggap lewat.
const BACKDATE_HOURS = 25;

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

  test("place bid dengan checklist + cooldown cancel 24 jam (rival@cverse.id)", async ({ page }) => {
    // Backdate butuh kredensial service role di apps/api/.dev.vars — fixture
    // availability skip (bukan bug produk), pola yang sama dengan 08-settlement.
    test.skip(
      !isDbFixtureAvailable(),
      "reason: apps/api/.dev.vars tidak ada/ tidak berisi SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — backdate bid tidak bisa jalan",
    );
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
    // Bid sisa bisa jadi segar (< 24 jam) → backdate dulu supaya cooldown lewat.
    // Toast difilter per-teks: toast sukses sebelumnya hidup 4 detik (TTL) sehingga
    // locator .toast-success polos bisa resolve >1 elemen (strict mode violation).
    const cancelBtn = page.locator("button:has-text('Batalkan bid')");
    if (await cancelBtn.isVisible()) {
      await backdateActiveBids("card-aespa-live-02", BACKDATE_HOURS);
      await page.reload();
      await cancelBtn.click();
      const cancelConfirm = page.locator(".cfm-card");
      await expect(cancelConfirm).toContainText("Batalkan bid");
      await cancelConfirm.locator("button:has-text('Batalkan bid')").click();
      await expect(page.locator(".toast-success").filter({ hasText: "Bid dibatalkan" })).toBeVisible();
      await expect(cancelBtn).toBeHidden();
    }

    // Place bid 5 C → modal konfirmasi (useConfirm, wajib untuk aksi spend)
    // + checklist wajib (founder 2026-09-01): tombol "Tawar" terkunci sampai
    // checkbox dicentang. place_bid RPC menahan C-Coin (escrow_hold).
    await bidInput.fill("5");
    await page.locator("button:has-text('Tawar')").first().click();
    const confirmModal = page.locator(".cfm-card");
    await expect(confirmModal).toContainText("Tawar 5 C?");
    const confirmBtn = confirmModal.locator("button:has-text('Tawar')");
    await expect(confirmBtn).toBeDisabled();
    await expect(confirmModal.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
    await confirmModal.getByRole("checkbox", { name: "Saya paham bid baru bisa dibatalkan setelah 24 jam." }).check();
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(page.locator(".toast-success").filter({ hasText: "Penawaran 5 C terkirim" })).toBeVisible();

    const bidPanel = page.locator(".ci-bid-panel");
    await expect(bidPanel).toContainText("BID KAMU");
    await expect(bidPanel).toContainText("5 C");

    // Perilaku baru (founder 2026-09-01): bid segar terkunci oleh cooldown —
    // tombol cancel disabled + info statis "Bisa dibatalkan <datetime>".
    await expect(page.locator("button:has-text('Batalkan bid')")).toBeDisabled();
    await expect(page.locator(".ci-cancel-note")).toContainText("Bisa dibatalkan");

    // Cleanup + teardown cooldown: backdate created_at -25 jam → reload →
    // tombol cancel aktif kembali → cancel via modal konfirmasi (D8) —
    // sekaligus menguji cancel_bid RPC (saldo demo ter-refund, slot bid
    // aktif demo tidak naik).
    await backdateActiveBids("card-aespa-live-02", BACKDATE_HOURS);
    await page.reload();
    await expect(page.locator("button:has-text('Batalkan bid')")).toBeEnabled();
    await page.locator("button:has-text('Batalkan bid')").click();
    const cancelConfirm = page.locator(".cfm-card");
    await expect(cancelConfirm).toContainText("Batalkan bid");
    await cancelConfirm.locator("button:has-text('Batalkan bid')").click();
    await expect(page.locator(".toast-success").filter({ hasText: "Bid dibatalkan" })).toBeVisible();
    await expect(page.locator(".ci-bid-panel")).toBeHidden();
  });
});
