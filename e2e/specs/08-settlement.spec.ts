import { expect, type Page, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

/**
 * Settlement / money e2e (flow F1-F3 primary pipeline, UI-driven).
 *
 * Realitas fixture bench lokal (seed.sql, NO db ops di lane ini):
 * - Kedua drop live (drop-aespa-live, drop-genesis-live) MASIH di raffle window
 *   (raffle_end_at di masa depan, drawn_at null). RPC `checkout`
 *   (supabase/migrations/04_rpc.sql:291-295) menolak checkout saat raffle window
 *   aktif (DROP_NOT_LIVE) — tombol "Beli Sekarang" (FCFS) hanya muncul setelah
 *   draw, dan draw hanya jalan via cron `scheduled` (tidak aktif di dev:node).
 * - demo@cverse.id SUDAH punya orders settled di kedua drop live → RPC
 *   `drop_entry` menolak ENTRY_EXISTS (guard double-allocation).
 * - karina@creator.id bersih di kedua drop live + saldo cukup (seed ~545 C).
 *
 * Jadi money mutation yang BENERAN bisa didorong lewat UI di bench ini:
 * raffle entry = wallet_debit escrow_hold persis sebesar hold price (04_rpc.sql:454).
 * Checkout FCFS penuh dites kondisional (test kedua) — skip eksplisit jika
 * fixture drawn drop tidak ada; itu ketersediaan fixture, bukan bug produk.
 */

/** Baca saldo C-Coin dari /wallet (.wa-balance-value — Wallet.tsx). */
async function readBalance(page: Page): Promise<number> {
  await page.goto("/wallet");
  const value = page.locator(".wa-balance-value");
  await expect(value).toBeVisible({ timeout: 10000 });
  const parsed = Number.parseInt((await value.textContent())?.trim() ?? "", 10);
  if (!Number.isFinite(parsed)) throw new Error(`Saldo tidak terbaca dari .wa-balance-value: "${await value.textContent()}"`);
  return parsed;
}

/** Kumpulkan href detail drop unik dari list /drops (href berbentuk /drops/<id>).
 *  Drop seed (id berawalan "drop-") diprioritaskan duluan — bench bisa berisi
 *  fixture drop lain (mis. "lb-*" dari test RPC lane lain) yang tidak kanonik. */
async function collectDropHrefs(page: Page): Promise<string[]> {
  await page.goto("/drops");
  const links = page.locator("a[href*='/drops/']");
  await links.first().waitFor({ state: "visible", timeout: 10000 });
  const seedHrefs: string[] = [];
  const otherHrefs: string[] = [];
  const total = await links.count();
  for (let i = 0; i < total; i++) {
    const href = await links.nth(i).getAttribute("href");
    if (!href || !/\/drops\/[a-z0-9-]+$/.test(href)) continue;
    if (seedHrefs.includes(href) || otherHrefs.includes(href)) continue;
    if (/\/drops\/drop-/.test(href)) seedHrefs.push(href);
    else otherHrefs.push(href);
  }
  return [...seedHrefs, ...otherHrefs];
}

test.describe("Settlement (money flow)", () => {
  test.beforeEach(async () => {
    await clearMailbox("karina@creator.id");
    await clearMailbox("demo@cverse.id");
  });

  test("raffle entry menahan C-Coin persis sebesar harga hold (escrow_hold)", async ({ page }) => {
    test.setTimeout(120_000); // iterasi beberapa drop detail + login magic link
    await loginAs(page, "karina@creator.id");
    const balanceBefore = await readBalance(page);

    const hrefs = await collectDropHrefs(page);
    let holdAmount = 0;
    let enteredNow = false;
    let entrySeen = false;

    for (const href of hrefs) {
      await page.goto(href);
      // Tunggu detail termuat (React Query) — isVisible() bersifat instant dan
      // akan melewatkan drop yang masih menampilkan "Memuat…".
      const isLoaded = await page
        .locator(".cm-panel")
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (!isLoaded) continue;
      // Path A: entry dari run sebelumnya — pill "Sudah ikut (…) — N C ditahan"
      // (DropDetail.tsx cm-phase-pill). Idempotent terhadap re-run suite.
      const pill = page.locator(".cm-phase-pill", { hasText: "Sudah ikut" });
      if (await pill.isVisible().catch(() => false)) {
        const match = (await pill.textContent())?.match(/(\d+) C/);
        if (match) {
          holdAmount = Number.parseInt(match[1], 10);
          entrySeen = true;
          break;
        }
      }
      // Path B: CTA raffle aktif — valid hanya jika window countdown berjalan
      // (drop-seed-karina-01 render panel raffle TANPA window → drop_entry
      // akan ENTRY_CLOSED, jadi disaring di sini via .cm-countdown-value).
      const countdown = page.locator(".cm-countdown-value");
      const hasWindow = (await countdown.isVisible().catch(() => false)) && /\d/.test((await countdown.textContent()) ?? "");
      const cta = page.locator("button", { hasText: /Ikuti Raffle · tahan (\d+) C/ });
      const isCtaVisible = await cta
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!hasWindow || !isCtaVisible) continue;

      const ctaText = (await cta.textContent()) ?? "";
      holdAmount = Number.parseInt(ctaText.match(/tahan (\d+) C/)?.[1] ?? "0", 10);
      await cta.click();
      // D8: spend wajib lewat in-app confirm modal (ConfirmProvider) — bukan window.confirm.
      // Checklist wajib (founder 2026-09-01): confirm terkunci sampai checkbox
      // "tidak bisa dibatalkan" dicentang.
      const dialog = page.locator('[role="dialog"]', { hasText: "Ikut raffle" });
      await expect(dialog).toBeVisible({ timeout: 5000 });
      const confirmBtn = dialog.getByRole("button", { name: "Ikut", exact: true });
      await expect(confirmBtn).toBeDisabled();
      await dialog.getByRole("checkbox", { name: "Saya paham mengikuti raffle tidak bisa dibatalkan." }).check();
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();
      // Sukses: onNavHome() → /home. Gagal (mis. ENTRY_CLOSED) → tetap di halaman.
      const isSuccessful = await page
        .waitForURL(/\/home/, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (isSuccessful) {
        enteredNow = true;
        entrySeen = true;
        break;
      }
    }

    if (!entrySeen) {
      throw new Error(
        `Tidak ada drop raffle yang bisa di-entry untuk karina@creator.id (dicek ${hrefs.length} drop). ` +
          "Seed menjamin 2 drop live dengan raffle window (aespa-live/genesis-live) dan karina bersih.",
      );
    }
    expect(holdAmount).toBeGreaterThan(0);

    // Bukti money mutation di ledger: baris "Escrow ditahan" dengan -N C (Riwayat /wallet).
    await page.goto("/wallet");
    const holdRow = page.locator("tr", { hasText: "Escrow ditahan" }).filter({ hasText: `-${holdAmount} C` });
    await expect(holdRow.first()).toBeVisible({ timeout: 10000 });

    // Saat entry baru dibuat di run INI → saldo turun PERSIS sebesar hold.
    if (enteredNow) {
      const balanceAfter = await readBalance(page);
      expect(balanceAfter, `saldo harus turun persis ${holdAmount} C (escrow hold)`).toBe(balanceBefore - holdAmount);
    }
  });

  test("checkout FCFS penuh: saldo turun persis harga + kartu masuk koleksi", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "demo@cverse.id");

    // Iterasi drop SEED saja (id "drop-*") — cari yang benar-benar buyable
    // (fase FCFS: drawn_at sudah lewat + sisa stok), jangan percaya urutan list.
    // Fixture drop non-seed (mis. "flow-*"/"lb-*" sisan test lane lain) sengaja
    // diabaikan: state-nya tidak kanonik dan bisa berubah kapan saja.
    const hrefs = (await collectDropHrefs(page)).filter((href) => /\/drops\/drop-/.test(href));
    let checkoutHref = "";
    for (const href of hrefs) {
      await page.goto(href);
      const buyNow = page.locator("a.btn-gold.cm-cta", { hasText: "Beli Sekarang" });
      // Auto-wait: tunggu detail selesai loading sebelum menyimpulkan fase.
      const isBuyable = await buyNow
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (isBuyable) {
        checkoutHref = `${href}/checkout`;
        break;
      }
    }
    // Fixture-availability skip (bukan bug produk): di bench fresh tidak ada drop
    // ber-fase FCFS karena raffle draw hanya jalan via cron wrangler `scheduled`,
    // tidak aktif di dev:node. Checkout RPC memang menolak pembelian saat raffle
    // window aktif (04_rpc.sql:291-295) — perilaku produk yang benar; kontrak
    // fase ditegaskan di komentar atas file ini.
    test.skip(
      !checkoutHref,
      "reason: tidak ada drop ber-fase FCFS (drawn_at terisi + sisa stok) di bench — seed hanya punya live drops di raffle window dan draw cron tidak jalan di dev:node",
    );

    // Basemap koleksi SEBELUM purchase — kartu baru harus menambah jumlah link.
    await page.goto("/collection");
    const cardsBefore = await page.locator("a[href*='/cards/']").count();

    await page.goto(checkoutHref);
    // Checkout page menampilkan harga persis (.cm-summary-total — Checkout.tsx).
    const totalEl = page.locator(".cm-summary-total");
    await expect(totalEl).toBeVisible({ timeout: 10000 });
    const price = Number.parseInt((await totalEl.textContent())?.match(/(\d+) C/)?.[1] ?? "0", 10);
    expect(price).toBeGreaterThan(0);

    const balanceBefore = await readBalance(page);
    await page.goto(checkoutHref);
    await page.locator("button", { hasText: new RegExp(`Bayar ${price} C`) }).click();

    // Sukses → redirect ke halaman order + toast sukses (toast persist antar route).
    await expect(page).toHaveURL(/\/orders\//, { timeout: 15000 });
    await expect(page.locator("text=Checkout berhasil").first()).toBeVisible({ timeout: 10000 });

    const balanceAfter = await readBalance(page);
    expect(balanceAfter, "saldo harus turun persis sebesar harga checkout").toBe(balanceBefore - price);

    // Kartu hasil purchase muncul di /collection (settle straight to vault):
    // jumlah link kartu bertambah dibanding baseline sebelum bayar.
    await page.goto("/collection");
    const cardLinks = page.locator("a[href*='/cards/']");
    await expect(cardLinks.first()).toBeVisible({ timeout: 10000 });
    const cardsAfter = await cardLinks.count();
    expect(cardsAfter, "koleksi harus bertambah 1 kartu setelah checkout").toBeGreaterThan(cardsBefore);
  });
});
