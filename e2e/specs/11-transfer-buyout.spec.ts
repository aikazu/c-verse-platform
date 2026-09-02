import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../helpers";

/**
 * F6/F7 — accept-bid ownership transfer + buyout purchase via UI PENGGUNA ASLI.
 *
 * - F6: demo bid di kartu fixture milik rival → rival accept via /me/manage →
 *   kepemilikan pindah ke demo, rival kredit seller share, kartu masuk C-12.
 * - F7: rival pasang harga buyout via /me/manage → demo beli via /cards/:id →
 *   saldo demo -harga persis, kartu pindah ke koleksi demo + keluar marketplace.
 *
 * Fixture: kartu BARU prefix `e2e-tfr-` (bukan kartu seed) di-insert via REST
 * service-role (pola parse .dev.vars dari 09-webhook-negative.spec.ts; nilai
 * secret tidak pernah di-echo). Kolom kartu dicerminkan dari INSERT kartu
 * milik rival di supabase/seed.sql (bound/registered/with_owner/passed).
 * Ledger (wallet_transactions, platform_revenue) append-only — tidak & tidak
 * bisa dihapus; baris kartu/bid/ownership_history di-cleanup di akhir.
 */

const RIVAL_ID = "00000000-0000-4000-8000-000000000006";
const DEMO_ID = "00000000-0000-4000-8000-000000000001";
const BID_CARD_ID = "e2e-tfr-bid-01";
const BID_SHORT_ID = "E2T-B01";
const BID_UNIT = 96;
const BUY_CARD_ID = "e2e-tfr-buy-01";
const BUY_SHORT_ID = "E2T-B02";
const BUY_UNIT = 97;
const DROP_ID = "drop-genesis-live";
const BID_AMOUNT = 7;
const BUYOUT_PRICE = 25;
// Secondary split 7.5/7.5/85 (04_rpc.sql accept_bid/buyout_card, Postgres
// round numeric half-up): 7 C → platform 1 + royalty 1 → seller 5;
// 25 C → platform 2 + royalty 2 → seller 21. Seller share dihitung ulang
// eksak di masing-masing test karena nominal mengikuti saldo demo saat run.

interface WalletRow {
  user_id: string;
  balance_ccoin: number;
}

interface CardRow {
  id: string;
  owner_id: string | null;
  status: string;
  location: string;
  buyout_price_ccoin: number | null;
}

interface OwnershipRow {
  owner_id: string;
  acquired_via: string;
  transferred_at: string;
}

/** Baca satu variabel dari apps/api/.dev.vars (null jika file/key absen/kosong). */
function readDevVar(key: string): string | null {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), "apps/api/.dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (match && match[1] === key) {
        const value = match[2].trim();
        return value.length > 0 ? value : null;
      }
    }
  } catch {
    // .dev.vars absen (gitignored)
  }
  return null;
}

function supabaseRest(): { base: string; headers: Record<string, string> } | null {
  const base = readDevVar("SUPABASE_URL");
  const serviceKey = readDevVar("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !serviceKey) return null;
  return {
    base,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
  };
}

async function restRows(rest: { base: string; headers: Record<string, string> }, table: string, query: string): Promise<unknown[]> {
  const res = await fetch(`${rest.base}/rest/v1/${table}?${query}`, { headers: rest.headers });
  if (!res.ok) throw new Error(`REST select ${table} gagal: HTTP ${res.status}`);
  return (await res.json()) as unknown[];
}

async function restInsert(rest: { base: string; headers: Record<string, string> }, table: string, row: object): Promise<void> {
  const res = await fetch(`${rest.base}/rest/v1/${table}`, {
    method: "POST",
    headers: rest.headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`REST insert ${table} gagal: HTTP ${res.status} ${await res.text()}`);
}

/** Hapus kartu fixture (bids + ownership_history ikut via ON DELETE CASCADE). */
async function restDeleteCard(rest: { base: string; headers: Record<string, string> }, cardId: string): Promise<boolean> {
  const res = await fetch(`${rest.base}/rest/v1/cards?id=eq.${cardId}`, { method: "DELETE", headers: rest.headers });
  return res.ok;
}

/** Insert kartu fixture milik rival + ownership history (transferred_at = now → C-12 aktif). */
async function insertFixtureCard(
  rest: { base: string; headers: Record<string, string> },
  cardId: string,
  shortId: string,
  unit: number,
): Promise<void> {
  await restInsert(rest, "cards", {
    id: cardId,
    drop_id: DROP_ID,
    unit_number: unit,
    variant: "unsigned",
    status: "bound",
    owner_id: RIVAL_ID,
    nfc_uid: `E2EUID-${shortId}`,
    nfc_short_id: shortId,
    verify_status: "registered",
    location: "with_owner",
    buyout_price_ccoin: null,
    nfc_configured: true,
    qc_status: "passed",
    last_ctr: 1,
  });
  await restInsert(rest, "ownership_history", {
    id: `e2e-tfr-oh-${cardId}`,
    card_id: cardId,
    owner_id: RIVAL_ID,
    acquired_via: "gift",
  });
}

async function readBalance(rest: { base: string; headers: Record<string, string> }, userId: string): Promise<number> {
  const rows = (await restRows(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_ccoin`)) as WalletRow[];
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_ccoin;
}

/** Dual-token (docs/07): saldo C-Gems — seller share secondary dibayar gems. */
async function readGemsBalance(rest: { base: string; headers: Record<string, string> }, userId: string): Promise<number> {
  const rows = (await restRows(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_gems`)) as Array<{
    balance_gems: number;
  }>;
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_gems;
}

/**
 * Fixture top-up terkontrol: bench e2e dipakai beberapa lane — saldo demo bisa
 * sudah 0 saat test ini jalan. Kredit saldo via ledger (wallet_transactions
 * append-only: INSERT diizinkan guard; UPDATE/DELETE yang diblokir) + sinkron
 * wallets agar invarian "balance = sum(ledger)" tetap tertutup. Baris ledger
 * tidak bisa dihapus (guard) → leftover kecil, dideklarasikan di report.
 */
async function ensureBalance(rest: { base: string; headers: Record<string, string> }, userId: string, minBalance: number): Promise<number> {
  const currentBalance = await readBalance(rest, userId);
  if (currentBalance >= minBalance) return currentBalance;
  const credit = minBalance - currentBalance;
  await restInsert(rest, "wallet_transactions", {
    id: `e2e-tfr-topup-${userId.slice(-1)}-${Date.now()}`,
    user_id: userId,
    type: "adjustment",
    amount_ccoin: credit,
    balance_after_ccoin: minBalance,
    ref_type: "e2e-fixture",
    ref_id: "11-transfer-buyout",
    note: "e2e fixture top-up — bench bersama, saldo seed terkuras run lane lain",
  });
  const patchRes = await fetch(`${rest.base}/rest/v1/wallets?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: rest.headers,
    body: JSON.stringify({ balance_ccoin: minBalance }),
  });
  if (!patchRes.ok) throw new Error(`Fixture top-up wallets gagal: HTTP ${patchRes.status}`);
  return minBalance;
}

async function readCardRow(rest: { base: string; headers: Record<string, string> }, cardId: string): Promise<CardRow> {
  const rows = (await restRows(rest, "cards", `id=eq.${cardId}&select=id,owner_id,status,location,buyout_price_ccoin`)) as CardRow[];
  if (rows.length !== 1) throw new Error(`Kartu ${cardId} tidak tepat 1 baris (${rows.length})`);
  return rows[0];
}

async function cleanupFixtureRows(rest: { base: string; headers: Record<string, string> } | null): Promise<void> {
  if (!rest) return;
  for (const cardId of [BID_CARD_ID, BUY_CARD_ID]) {
    const isDeleted = await restDeleteCard(rest, cardId);
    if (!isDeleted) console.log(`[11-transfer-buyout] leftover kartu ${cardId} gagal dihapus (FK/trigger) — dideklarasikan di report`);
  }
}

/**
 * Login dengan retry: bench e2e dipakai bersama — magic-link satu pakai bisa
 * terhapus/terpakai oleh run lane lain yang men-clear mailbox email yang sama.
 * Tiap retry mengirim magic link baru (loginAs selalu clear mailbox dulu).
 */
async function loginWithRetry(page: Page, email: string, attempts = 3): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await loginAs(page, email);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`login ${email} gagal ${attempts}x`);
}

test.describe("Secondary transfer — accept-bid & buyout (F6/F7)", () => {
  // 2 login magic-link + alur UI ganda dalam satu test.
  test.setTimeout(240_000);

  const rest: { base: string; headers: Record<string, string> } | null = supabaseRest();

  test.beforeEach(async () => {
    // Idempoten antar-run: sisa fixture run sebelumnya (crash mid-test) dihapus dulu.
    await cleanupFixtureRows(rest);
  });

  test.afterEach(async () => {
    await cleanupFixtureRows(rest);
  });

  test("F6: accept-bid rival memindahkan kartu ke demo (owner, saldo, C-12)", async ({ page, browser }) => {
    if (!rest) test.skip(true, "fixture unavailable: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absen di apps/api/.dev.vars");
    await insertFixtureCard(rest, BID_CARD_ID, BID_SHORT_ID, BID_UNIT);

    // Benchmark bersama: pastikan saldo demo cukup untuk bid (biasanya sudah).
    const demoBalanceBefore = await ensureBalance(rest, DEMO_ID, BID_AMOUNT + 2);
    const rivalBalanceBefore = await readBalance(rest, RIVAL_ID);
    const rivalGemsBefore = await readGemsBalance(rest, RIVAL_ID);
    // Nominal bid mengikuti saldo saat ini; biasanya tetap 7 C. Seller share eksak:
    // platform = royalty = round(amount*0.075) (Postgres round half-up; JS
    // Math.round bernilai sama untuk hasil positif termasuk kasus tepat .5).
    const bidAmount = Math.min(BID_AMOUNT, Math.max(1, demoBalanceBefore - 2));
    const bidSellerCredit = bidAmount - Math.round(bidAmount * 0.075) * 2;

    // ── demo: place bid via UI (B2: /browse per-drop — kartu dibuka langsung
    // via URL detail) ──
    await loginWithRetry(page, "demo@cverse.id");
    await page.goto(`/cards/${BID_CARD_ID}`);
    await expect(page).toHaveURL(`http://localhost:5173/cards/${BID_CARD_ID}`);

    const bidInput = page.locator('input[aria-label="Jumlah tawaran C-Coin"]');
    await expect(bidInput).toBeVisible({ timeout: 10000 });
    await bidInput.fill(String(bidAmount));
    await page.locator("button:has-text('Tawar')").first().click();
    const bidConfirm = page.locator(".cfm-card");
    await expect(bidConfirm).toContainText(`Tawar ${bidAmount} C?`);
    // Checklist wajib (owner 2026-09-01): confirm mati sampai checkbox dicentang.
    await bidConfirm.getByRole("checkbox").check();
    await bidConfirm.locator("button:has-text('Tawar')").click();
    await expect(page.locator(".toast-success").filter({ hasText: `Penawaran ${bidAmount} C terkirim` })).toBeVisible();
    await expect(page.locator(".ci-bid-panel")).toContainText(`${bidAmount} C`);

    // Escrow hold: saldo demo -nominal persis saat bid (accept TIDAK memotong lagi).
    const demoBalanceAfterBid = await readBalance(rest, DEMO_ID);
    expect(demoBalanceAfterBid).toBe(demoBalanceBefore - bidAmount);

    // ── rival (context terpisah): accept bid via /me/manage ──
    const rivalContext = await browser.newContext();
    const rivalPage = await rivalContext.newPage();
    await loginWithRetry(rivalPage, "rival@cverse.id");
    await rivalPage.goto("/me/manage");
    // Guard bench-bersama: RequireAuth bisa memantul ke /login saat auth state
    // belum resolve (magic link baru diverifikasi) — re-login sekali lalu ulang.
    if (!rivalPage.url().includes("/me/manage")) {
      await loginWithRetry(rivalPage, "rival@cverse.id");
      await rivalPage.goto("/me/manage");
    }
    await expect(rivalPage.locator("h1")).toContainText("Kelola", { timeout: 15000 });
    const rivalEntry = rivalPage.locator(".ac-card").filter({ hasText: `#${BID_UNIT}` });
    await expect(rivalEntry).toBeVisible({ timeout: 15000 });

    // Surface owner: incoming bid terlihat + modal konfirmasi wajib (D8) muncul.
    await rivalEntry
      .locator("summary")
      .filter({ hasText: `Terima Tawaran ${bidAmount} C` })
      .click();
    await rivalEntry.locator("button:has-text('Terima →')").click();
    const acceptConfirm = rivalPage.locator(".cfm-card");
    await expect(acceptConfirm).toContainText(`Terima tawaran ${bidAmount} C?`);
    await acceptConfirm.locator("button:has-text('Terima')").click();

    // Accept selesai via UI asli — api.acceptBidOnCard kini mengirim body `{}`
    // sesuai kontrak zValidator (acceptBidSchema strict) → toast sukses muncul.
    await expect(rivalPage.locator(".toast-success").filter({ hasText: "Penawaran diterima" })).toBeVisible();

    // Kartu keluar dari daftar Kelola C.Card rival (owner berubah, fresh fetch).
    await rivalPage.goto("/me/manage");
    await expect(rivalEntry).toHaveCount(0, { timeout: 10000 });

    // Saldo rival via UI: seller share masuk sebagai C-GEMS (dual-token docs/07 —
    // penghasilan secondary = gems, terkunci 24 jam), C-Coin rival tak berubah.
    await rivalPage.goto("/wallet");
    const rivalGemsValue = rivalPage.locator(".wa-balance", { hasText: "Saldo C-Gems" }).locator(".wa-balance-value");
    await expect(rivalGemsValue).toBeVisible({ timeout: 10000 });
    await expect(rivalGemsValue).toHaveText(String(rivalGemsBefore + bidSellerCredit));
    await expect(rivalPage.locator(".wa-balance", { hasText: "Saldo C-Coin" }).locator(".wa-balance-value")).toHaveText(
      String(rivalBalanceBefore),
    );
    await rivalContext.close();

    // ── demo: kartu kini miliknya (koleksi + label pemilik) ──
    await page.goto("/collection");
    await expect(page.locator(`a.kl-tile[href="/cards/${BID_CARD_ID}"]`)).toBeVisible({ timeout: 10000 });
    await page.goto(`/cards/${BID_CARD_ID}`);
    const ownerRow = page.locator(".ci-stat-row").filter({ hasText: "Pemilik" });
    await expect(ownerRow).toContainText("Demo Kolektor", { timeout: 10000 });

    // ── DB truth via REST service-role ──
    const cardRow = await readCardRow(rest, BID_CARD_ID);
    expect(cardRow.owner_id).toBe(DEMO_ID);
    expect(cardRow.status).toBe("sold");
    expect(cardRow.location).toBe("platform_vault");
    expect(cardRow.buyout_price_ccoin).toBeNull();

    const rivalBalanceAfter = await readBalance(rest, RIVAL_ID);
    expect(rivalBalanceAfter).toBe(rivalBalanceBefore);
    expect(await readGemsBalance(rest, RIVAL_ID)).toBe(rivalGemsBefore + bidSellerCredit);
    const demoBalanceAfter = await readBalance(rest, DEMO_ID);
    expect(demoBalanceAfter).toBe(demoBalanceBefore - bidAmount);

    const history = (await restRows(
      rest,
      "ownership_history",
      `card_id=eq.${BID_CARD_ID}&select=owner_id,acquired_via,transferred_at&order=transferred_at.desc`,
    )) as OwnershipRow[];
    expect(history.some((h) => h.owner_id === DEMO_ID && h.acquired_via === "secondary_bid")).toBe(true);
    // C-12: rival masih memegang history row < 24 jam → rebuy/bid-nya terblokir RPC.
    const rivalC12 = history.some((h) => h.owner_id === RIVAL_ID && Date.now() - Date.parse(h.transferred_at) < 24 * 60 * 60 * 1000);
    expect(rivalC12).toBe(true);
  });

  test("F7: buyout demo membeli kartu rival (saldo -harga persis, keluar marketplace)", async ({ page, browser }) => {
    if (!rest) test.skip(true, "fixture unavailable: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absen di apps/api/.dev.vars");
    await insertFixtureCard(rest, BUY_CARD_ID, BUY_SHORT_ID, BUY_UNIT);

    // Benchmark bersama: pastikan saldo demo cukup untuk buyout (biasanya sudah).
    const demoBalanceBefore = await ensureBalance(rest, DEMO_ID, BUYOUT_PRICE + 5);
    const rivalBalanceBefore = await readBalance(rest, RIVAL_ID);
    const rivalGemsBefore = await readGemsBalance(rest, RIVAL_ID);
    // Harga buyout mengikuti saldo saat ini; biasanya tetap 25 C.
    // demo saat ini (biasanya tetap 25 C). Seller share eksak: price - round*2.
    const buyoutPrice = Math.min(BUYOUT_PRICE, Math.max(1, demoBalanceBefore - 5));
    const buyoutSellerCredit = buyoutPrice - Math.round(buyoutPrice * 0.075) * 2;

    // ── rival: pasang harga buyout via /me/manage (Aksi 1) ──
    const rivalContext = await browser.newContext();
    const rivalPage = await rivalContext.newPage();
    await loginWithRetry(rivalPage, "rival@cverse.id");
    await rivalPage.goto("/me/manage");
    if (!rivalPage.url().includes("/me/manage")) {
      await loginWithRetry(rivalPage, "rival@cverse.id");
      await rivalPage.goto("/me/manage");
    }
    await expect(rivalPage.locator("h1")).toContainText("Kelola", { timeout: 15000 });
    const rivalEntry = rivalPage.locator(".ac-card").filter({ hasText: `#${BUY_UNIT}` });
    await expect(rivalEntry).toBeVisible({ timeout: 15000 });
    await expect(rivalEntry).toContainText("Tidak dijual");

    await rivalEntry.locator("summary").filter({ hasText: "Pasang / Ubah Harga Jual" }).click();
    await rivalEntry.locator('input[aria-label="Harga jual C-Coin"]').fill(String(buyoutPrice));
    await rivalEntry.locator("button:has-text('Simpan')").click();
    await expect(rivalPage.locator(".toast-success").filter({ hasText: `Dijual ${buyoutPrice} C` })).toBeVisible();
    await expect(rivalEntry).toContainText(`${buyoutPrice} C · Dijual`);

    const listedRow = await readCardRow(rest, BUY_CARD_ID);
    expect(listedRow.buyout_price_ccoin).toBe(buyoutPrice);
    expect(listedRow.status).toBe("listed_buyout");
    await rivalContext.close();

    // ── demo: beli buyout via UI (/marketplace ada → detail → confirm modal) ──
    await loginWithRetry(page, "demo@cverse.id");
    await page.goto("/marketplace");
    const marketLink = page.locator(`a.market-card[href*="${BUY_CARD_ID}"]`);
    await expect(marketLink).toBeVisible({ timeout: 10000 });

    // B2: /browse per-drop — kartu dibuka langsung via URL detail.
    await page.goto(`/cards/${BUY_CARD_ID}`);
    await expect(page).toHaveURL(`http://localhost:5173/cards/${BUY_CARD_ID}`);

    const pricePanel = page.locator(".ci-price-panel");
    await expect(pricePanel).toContainText(`${buyoutPrice} C`);
    await page.locator("button:has-text('Beli di harga buyout')").click();
    await page.locator(`button:has-text('Beli ${buyoutPrice} C')`).click();
    const buyConfirm = page.locator(".cfm-card");
    await expect(buyConfirm).toContainText(`Beli ${buyoutPrice} C?`);
    await buyConfirm.locator("button:has-text('Beli')").click();
    await expect(page.locator(".toast-success").filter({ hasText: "C.Card dibeli" })).toBeVisible();

    // Saldo demo via UI: -harga buyout persis.
    await page.goto("/wallet");
    const demoBalanceValue = page.locator(".wa-balance", { hasText: "Saldo C-Coin" }).locator(".wa-balance-value");
    await expect(demoBalanceValue).toBeVisible({ timeout: 10000 });
    await expect(demoBalanceValue).toHaveText(String(demoBalanceBefore - buyoutPrice));

    // Kartu masuk koleksi demo + hilang dari marketplace.
    await page.goto("/collection");
    await expect(page.locator(`a.kl-tile[href="/cards/${BUY_CARD_ID}"]`)).toBeVisible({ timeout: 10000 });
    await page.goto("/marketplace");
    await expect(page.locator(`a.market-card[href*="${BUY_CARD_ID}"]`)).toHaveCount(0, { timeout: 10000 });

    // ── DB truth via REST service-role ──
    const cardRow = await readCardRow(rest, BUY_CARD_ID);
    expect(cardRow.owner_id).toBe(DEMO_ID);
    expect(cardRow.status).toBe("sold");
    expect(cardRow.location).toBe("platform_vault");
    expect(cardRow.buyout_price_ccoin).toBeNull();

    const demoBalanceAfter = await readBalance(rest, DEMO_ID);
    expect(demoBalanceAfter).toBe(demoBalanceBefore - buyoutPrice);
    const rivalBalanceAfter = await readBalance(rest, RIVAL_ID);
    expect(rivalBalanceAfter).toBe(rivalBalanceBefore);
    expect(await readGemsBalance(rest, RIVAL_ID)).toBe(rivalGemsBefore + buyoutSellerCredit);

    const history = (await restRows(
      rest,
      "ownership_history",
      `card_id=eq.${BUY_CARD_ID}&select=owner_id,acquired_via&order=transferred_at.desc`,
    )) as OwnershipRow[];
    expect(history.some((h) => h.owner_id === DEMO_ID && h.acquired_via === "secondary_buyout")).toBe(true);
  });
});
