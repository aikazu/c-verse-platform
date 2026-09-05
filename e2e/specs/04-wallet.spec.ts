import { expect, type Page, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";
import { creditLockedGemsFixture, isDbFixtureAvailable, restoreGemsBalance } from "../helpers/db";

const KARINA_EMAIL = "karina@creator.id";
// UUID fixed seeds/*.sql (pola 13-support-winners) — karina, KYC approved.
const KARINA_USER_ID = "00000000-0000-4000-8000-000000000003";
// Dual-token (docs/07): seed karina = 45 C-Gems, SEMUA lot matured
// Event-closed seed includes royalty/settlement/payout history; gemsLocked = 0.
const SEED_GEMS_MATURED = 45;

/** Kartu saldo spesifik di /wallet — Wallet.tsx grid-2 (C-Coin lalu C-Gems). */
function balanceCard(page: Page, token: "C-Coin" | "C-Gems") {
  return page.locator(".wa-balance", { hasText: `Saldo ${token}` });
}

/** Parse angka saldo dari kartu (`.wa-balance-value`). */
async function readCardValue(page: Page, token: "C-Coin" | "C-Gems"): Promise<number> {
  const value = balanceCard(page, token).locator(".wa-balance-value");
  await expect(value).toBeVisible({ timeout: 10000 });
  const parsed = Number.parseInt((await value.textContent())?.trim() ?? "", 10);
  if (!Number.isFinite(parsed)) throw new Error(`Saldo ${token} tidak terbaca: "${await value.textContent()}"`);
  return parsed;
}

/** Parse angka chip "Bisa dicairkan · N" (= gemsMatured, Wallet.tsx). */
async function readMaturedChip(page: Page): Promise<number> {
  const chip = balanceCard(page, "C-Gems").locator(".pill-success");
  await expect(chip).toBeVisible({ timeout: 10000 });
  const match = (await chip.textContent())?.match(/Bisa dicairkan\s*·\s*(\d+)/);
  if (!match) throw new Error(`Chip "Bisa dicairkan" tidak terbaca: "${await chip.textContent()}"`);
  return Number.parseInt(match[1], 10);
}

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
    await expect(page.locator('select[aria-label="Jumlah isi saldo C-Coin"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button[class*=wa-btn-block]")).toBeVisible();
  });

  test("top-up wajib menyetujui dokumen legal sebelum lanjut ke pembayaran", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");

    await page.locator("button[class*=wa-btn-block]").click();
    const dialog = page.locator(".cfm-card", { hasText: "Isi saldo 50 C?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
    await expect(dialog.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute("href", "/legal/privacy");

    const confirmButton = dialog.getByRole("button", { name: "Bayar" });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(confirmButton).toBeEnabled();
  });

  test("payout terbuka untuk semua user: kontrol payout tampil, gate kreator hilang", async ({ page }) => {
    // Wallet.tsx (commit 29ecc38, docs/07 dual-token) — blok payout
    // ("Tarik ke Rekening" + tombol "Tarik") render untuk SEMUA role; pesan gate
    // "Penarikan hanya untuk kreator" sudah dihapus. Guard KYC + gems matured
    // tetap di-enforce server (RPC payout_request).
    // (demo@cverse.id role user + KYC pending di seeds/*.sql — deterministik).
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");

    // Kontrol payout tampil untuk non-kreator.
    await expect(page.locator("text=Tarik ke Rekening").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Tarik", exact: true })).toBeVisible();

    // Pesan gate kreator TIDAK boleh tampil lagi.
    await expect(page.getByText("hanya untuk kreator")).toHaveCount(0);

    // Messaging gate non-KYC (demo KYC-nya pending): cap saldo 500 C-Coin tampil.
    await expect(page.getByText("Sebelum verifikasi, saldo setelah pengisian maksimal")).toBeVisible();
    await expect(page.locator("text=500 C-Coin").first()).toBeVisible();

    // Dual-token: kartu C-Gems tetap tampil untuk user biasa, tapi demo 0 gems →
    // blok konversi tidak dirender (gate `balanceGems > 0` di Wallet.tsx).
    await expect(page.locator("text=Saldo C-Gems").first()).toBeVisible();
    await expect(page.locator("text=Tukar C-Gems ke C-Coin")).toHaveCount(0);
  });

  test("riwayat C-Gems: demo user 0 gems → section tampil dengan state kosong", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");

    // Section "Riwayat C-Gems" SELALU render (Wallet.tsx) — scope ke card-nya
    // via judul toolbar supaya tidak nyasar ke ledger C-Coin di atasnya.
    const gemsLedger = page.locator(".card").filter({ has: page.locator(".wa-toolbar-title", { hasText: "Riwayat C-Gems" }) });
    await expect(gemsLedger).toHaveCount(1);

    // Seed: demo user tidak punya gem_transactions → empty state eksplisit
    // "Belum ada transaksi" (satu baris colSpan=4), bukan tabel tanpa tbody.
    await expect(gemsLedger.locator("td.wa-td-empty")).toHaveText("Belum ada transaksi");
    await expect(gemsLedger.locator("tbody tr")).toHaveCount(1);

    // Payout terbuka untuk SEMUA user (docs/07 dual-token) — bukan hanya kreator.
    await expect(page.locator("text=Tarik ke Rekening").first()).toBeVisible();
    await expect(page.getByText("hanya untuk kreator")).toHaveCount(0);
  });
});

test.describe("Wallet dual-token (C-Gems)", () => {
  test.beforeEach(async () => {
    await clearMailbox(KARINA_EMAIL);
  });

  test("dual saldo C-Coin + C-Gems dengan breakdown matured/locked (seed karina)", async ({ page }) => {
    await loginAs(page, KARINA_EMAIL);
    await page.goto("/wallet");

    // Dua kartu saldo berdampingan (grid-2 Wallet.tsx).
    await expect(page.locator("text=Saldo C-Coin").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Saldo C-Gems").first()).toBeVisible();

    const gemsCard = balanceCard(page, "C-Gems");
    await expect(gemsCard.locator(".wa-balance-value")).toHaveText(String(SEED_GEMS_MATURED));
    // Seed: semua lot matured → chip bisa-cair 45, chip terkunci absen.
    await expect(gemsCard.locator(".pill-success")).toHaveText(/Bisa dicairkan\s*·\s*45$/);
    await expect(gemsCard.locator(".pill-warn", { hasText: "Terkunci" })).toHaveCount(0);

    // Blok konversi tampil (balanceGems > 0) + hint rate 1:1 + batas MAKS.
    await expect(page.locator("text=Tukar C-Gems ke C-Coin").first()).toBeVisible();
    await expect(page.locator("text=1 C-Gems = 1 C-Coin")).toBeVisible();
    await expect(page.locator(".wa-min-label", { hasText: `MAKS ${SEED_GEMS_MATURED}` })).toBeVisible();
    await expect(page.locator('input[aria-label="Jumlah C-Gems yang ditukar"]')).toBeVisible();

    // Kreator: blok payout beroperasi pada C-Gems (dual-token), bukan C-Coin.
    await expect(page.locator("text=Tarik ke Rekening").first()).toBeVisible();
    await expect(page.locator('input[aria-label="Jumlah penarikan C-Gems"]')).toBeVisible();
    await expect(page.locator(".wa-min-label", { hasText: "MIN 10 C-Gems" })).toBeVisible();
  });

  test("riwayat C-Gems karina: signed amounts and balances match the event-closed ledger", async ({ page }) => {
    await loginAs(page, KARINA_EMAIL);
    const walletResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/wallet" && response.request().method() === "GET",
    );
    await page.goto("/wallet");
    const payload = (await (await walletResponse).json()) as {
      gemTxs: Array<{ amount: number; balanceAfterGems: number; refType: string }>;
    };
    expect(payload.gemTxs.length).toBeGreaterThan(0);

    const gemsLedger = page.locator(".card").filter({ has: page.locator(".wa-toolbar-title", { hasText: "Riwayat C-Gems" }) });
    await expect(gemsLedger).toHaveCount(1);
    await expect(gemsLedger.locator(".wa-toolbar-title")).toHaveText("Riwayat C-Gems");

    // Check the actual latest page instead of pinning the obsolete five-row
    // fixture. SQL assertions independently verify event/ledger conservation.
    const expectedRows = payload.gemTxs.slice(0, 10);
    const rows = gemsLedger.locator("tbody tr");
    await expect(rows).toHaveCount(expectedRows.length);

    // Ledger gems 4 kolom (tanpa "Catatan" milik ledger C-Coin).
    await expect(gemsLedger.locator("thead th")).toHaveText(["Waktu", "Tipe", "Jumlah", "Saldo"]);

    const labels: Record<string, string> = {
      royalty: "Royalti",
      settlement: "Penyelesaian transaksi",
      support: "Dukungan",
      payout: "Penarikan",
    };
    for (const [index, transaction] of expectedRows.entries()) {
      const row = rows.nth(index);
      await expect(row.locator(".wa-td-amount")).toHaveText(`${transaction.amount > 0 ? "+" : ""}${transaction.amount} Gems`);
      await expect(row.locator(".wa-td-balance")).toHaveText(`${transaction.balanceAfterGems} Gems`);
      if (labels[transaction.refType]) await expect(row.locator(".pill")).toHaveText(labels[transaction.refType]);
    }
    await expect(rows.first().locator(".wa-td-balance")).toHaveText(`${SEED_GEMS_MATURED} Gems`);
  });

  test("payout sukses dari gems matured: gems -10 persis, C-Coin tak tersentuh", async ({ page }) => {
    await loginAs(page, KARINA_EMAIL);
    await page.goto("/wallet");

    const gemsBefore = await readCardValue(page, "C-Gems");
    const ccoinBefore = await readCardValue(page, "C-Coin");
    // Seed fresh = 45 matured ≥ min payout 10 — jalur e2e standar.
    expect(gemsBefore).toBeGreaterThanOrEqual(SEED_GEMS_MATURED);

    await page.fill('input[aria-label="Jumlah penarikan C-Gems"]', "10");
    await page.getByRole("button", { name: "Tarik", exact: true }).click();

    // Modal konfirmasi payout milik Wallet.tsx (P1-12) — ringkasan sebelum kunci dana.
    const payoutModal = page.getByRole("dialog");
    await expect(payoutModal.locator("#payout-confirm-title")).toHaveText("Konfirmasi penarikan");
    await expect(payoutModal.locator(".wa-modal-row", { hasText: "Biaya penarikan" })).toContainText("1 C-Gems");
    await expect(payoutModal.locator(".wa-modal-row", { hasText: "Perkiraan diterima sebelum pajak" })).toContainText(/Rp\s*90\.000/);
    await expect(payoutModal.getByRole("link", { name: "Kebijakan KYC" })).toHaveAttribute("href", "/legal/kyc");
    const payoutButton = payoutModal.getByRole("button", { name: "Ajukan penarikan" });
    await expect(payoutButton).toBeDisabled();
    await payoutModal.getByRole("checkbox").check();
    await expect(payoutButton).toBeEnabled();
    await payoutButton.click();

    await expect(page.locator(".toast-success", { hasText: "Permintaan penarikan dibuat" })).toBeVisible({
      timeout: 15000,
    });

    // Payout debit GEMS matured (docs/07) — saldo bisa-cair turun persis 10,
    // kartu C-Coin tidak berubah.
    await expect(balanceCard(page, "C-Gems").locator(".wa-balance-value")).toHaveText(String(gemsBefore - 10), {
      timeout: 15000,
    });
    await expect(balanceCard(page, "C-Gems").locator(".pill-success")).toHaveText(new RegExp(`Bisa dicairkan\\s*·\\s*${gemsBefore - 10}$`));
    await expect(balanceCard(page, "C-Coin").locator(".wa-balance-value")).toHaveText(String(ccoinBefore));
  });

  test("konversi Gems→C-Coin 1:1: confirm modal muncul, gems turun, C-Coin naik", async ({ page }) => {
    await loginAs(page, KARINA_EMAIL);
    await page.goto("/wallet");

    const gemsBefore = await readCardValue(page, "C-Gems");
    const ccoinBefore = await readCardValue(page, "C-Coin");

    await page.fill('input[aria-label="Jumlah C-Gems yang ditukar"]', "5");
    await page.getByRole("button", { name: "Tukar", exact: true }).click();

    // Konversi satu arah — wajib modal useConfirm (D8), bukan native confirm.
    const confirmModal = page.locator(".cfm-card");
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal.locator("#cfm-title")).toHaveText("Tukar 5 C-Gems ke C-Coin?");
    await expect(confirmModal).toContainText("Kamu akan mendapat 5 C-Coin. Penukaran ini tidak bisa dibatalkan.");
    await expect(confirmModal.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
    const convertButton = confirmModal.getByRole("button", { name: "Tukar" });
    await expect(convertButton).toBeDisabled();
    await confirmModal.getByRole("checkbox").check();
    await convertButton.click();

    await expect(page.locator(".toast-success", { hasText: "Penukaran berhasil. C-Coin masuk ke saldo." })).toBeVisible({ timeout: 15000 });

    // Rate 1:1 (docs/07): C-Coin +5, C-Gems -5.
    await expect(balanceCard(page, "C-Coin").locator(".wa-balance-value")).toHaveText(String(ccoinBefore + 5), {
      timeout: 15000,
    });
    await expect(balanceCard(page, "C-Gems").locator(".wa-balance-value")).toHaveText(String(gemsBefore - 5), {
      timeout: 15000,
    });
  });

  test("guard payout: minta lebih dari bisa-cair ditolak di UI tanpa modal", async ({ page }) => {
    await loginAs(page, KARINA_EMAIL);
    await page.goto("/wallet");

    const matured = await readMaturedChip(page);
    await page.fill('input[aria-label="Jumlah penarikan C-Gems"]', String(matured + 1));
    await page.getByRole("button", { name: "Tarik", exact: true }).click();

    // Guard client Wallet.tsx (payoutAmt > gemsMatured) → toast info, TIDAK
    // membuka modal konfirmasi payout.
    await expect(page.locator(".toast-info", { hasText: "Saldo bisa cair tidak cukup" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("gems terkunci: chip Terkunci 24 jam muncul, matured tak bergeser (fixture DB)", async ({ page }) => {
    test.skip(!isDbFixtureAvailable(), "Fixture DB butuh SUPABASE_URL + service role di apps/api/.dev.vars");
    await loginAs(page, KARINA_EMAIL);
    await page.goto("/wallet");

    const maturedBefore = await readMaturedChip(page);
    const totalBefore = await readCardValue(page, "C-Gems");

    // Lot terkunci +7 lewat RPC produksi wallet_credit_gems (p_matured=false →
    // mature_at now + 24 jam; chip copy pakai GEMS_LOCK_HOURS dari shared).
    const LOCKED_GEMS = 7;
    const REF_ID = `e2e-wallet-locked-${Date.now()}`;
    const balanceFromDb = await creditLockedGemsFixture(KARINA_USER_ID, LOCKED_GEMS, REF_ID);
    try {
      await page.reload();
      const gemsCard = balanceCard(page, "C-Gems");
      // Total naik 7, matured tetap — lot baru terkunci.
      await expect(gemsCard.locator(".wa-balance-value")).toHaveText(String(totalBefore + LOCKED_GEMS), {
        timeout: 15000,
      });
      await expect(gemsCard.locator(".pill-success")).toHaveText(new RegExp(`Bisa dicairkan\\s*·\\s*${maturedBefore}$`));
      const lockedChip = gemsCard.locator(".pill-warn", { hasText: "Terkunci" });
      await expect(lockedChip).toHaveText(new RegExp(`Terkunci\\s+\\d+ jam\\s*·\\s*${LOCKED_GEMS}$`));
    } finally {
      await restoreGemsBalance(KARINA_USER_ID, balanceFromDb, REF_ID);
    }
  });
});
