import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../helpers";
import { type RemoteServiceRest, remoteServiceRest } from "../helpers/db";

/**
 * Dukungan (fan → creator C-Coin support) + drop winners list.
 *
 * - Support: demo sends 1 C to Karina via /c/:handle UI (modal + in-app confirm).
 *   RPC send_support: 100% creator share (no platform cut) and sender XP 1:1
 *   per spent C — both asserted against DB truth. The wallet ledger is
 *   append-only, so the 1 C transfer persists across runs (declared leftover).
 * - Winners: finished drop (sold_out + drawn) lists #unit + Premium/Regular +
 *   display name. Seed fixture: drop-aespa-signed, 10 owned cards, unit 10 =
 *   the signed card.
 *
 * REST service-role fixture pattern from 11-transfer-buyout.spec.ts (secrets
 * never echoed).
 */

const DEMO_ID = "00000000-0000-4000-8000-000000000001";
const CREATOR_ID = "00000000-0000-4000-8000-000000000003";
const CREATOR_HANDLE = "karina_aespa";
const WINNERS_DROP_ID = "drop-aespa-signed";

interface WalletRow {
  user_id: string;
  balance_ccoin: number;
}

interface UserRow {
  total_xp: number;
}

interface BadgeRewardRow {
  xp_reward_snapshot: number;
}

async function restSelect<T>(rest: RemoteServiceRest, table: string, query: string): Promise<T[]> {
  const res = await fetch(`${rest.base}/rest/v1/${table}?${query}`, { headers: rest.headers });
  if (!res.ok) throw new Error(`REST select ${table} gagal: HTTP ${res.status}`);
  return (await res.json()) as T[];
}

async function readBalance(rest: RemoteServiceRest, userId: string): Promise<number> {
  const rows = await restSelect<WalletRow>(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_ccoin`);
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_ccoin;
}

/** Dual-token (docs/07): saldo C-Gems kreator (dukungan mengalir sebagai gems). */
async function readGemsBalance(rest: RemoteServiceRest, userId: string): Promise<number> {
  const rows = await restSelect<{ balance_gems: number }>(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_gems`);
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_gems;
}

async function readTotalXp(rest: RemoteServiceRest, userId: string): Promise<number> {
  const rows = await restSelect<UserRow>(rest, "users", `id=eq.${userId}&select=total_xp`);
  if (rows.length !== 1) throw new Error(`User ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].total_xp;
}

async function readBadgeXp(rest: RemoteServiceRest, userId: string): Promise<number> {
  const rows = await restSelect<BadgeRewardRow>(rest, "user_badges", `user_id=eq.${userId}&select=xp_reward_snapshot`);
  return rows.reduce((total, row) => total + row.xp_reward_snapshot, 0);
}

/**
 * Shared-bench guard: kredit hanya bila perlu lewat RPC kernel wallet, agar
 * wallet cache dan ledger berubah atomik tanpa PATCH langsung.
 */
async function ensureBalance(rest: RemoteServiceRest, userId: string, minBalance: number): Promise<number> {
  const currentBalance = await readBalance(rest, userId);
  if (currentBalance >= minBalance) return currentBalance;
  const credit = minBalance - currentBalance;
  const creditRes = await fetch(`${rest.base}/rest/v1/rpc/wallet_credit`, {
    method: "POST",
    headers: rest.headers,
    body: JSON.stringify({
      p_user: userId,
      p_amount: credit,
      p_type: "adjustment",
      p_ref_type: "e2e-fixture",
      p_ref_id: "13-support-winners",
      p_idem: `e2e-sup-credit-${Date.now()}`,
    }),
  });
  if (!creditRes.ok) throw new Error(`Fixture credit wallet gagal: HTTP ${creditRes.status}`);
  return readBalance(rest, userId);
}

/** Retry terbatas untuk kegagalan jaringan GoTrue remote; tidak mengirim email. */
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

test.describe("Dukungan kreator & daftar pemenang drop", () => {
  const rest = remoteServiceRest();

  test("Dukungan: kirim 1 C ke kreator via /c/:handle (transfer penuh + XP pengirim)", async ({ page }) => {
    const demoBalanceBefore = await ensureBalance(rest, DEMO_ID, 2);
    const creatorBalanceBefore = await readBalance(rest, CREATOR_ID);
    const creatorGemsBefore = await readGemsBalance(rest, CREATOR_ID);
    const demoXpBefore = await readTotalXp(rest, DEMO_ID);
    const demoBadgeXpBefore = await readBadgeXp(rest, DEMO_ID);

    await loginWithRetry(page, "demo@cverse.id");
    await page.goto(`/c/${CREATOR_HANDLE}`);
    const supportButton = page.locator("button.cp-support-btn");
    await expect(supportButton).toBeVisible({ timeout: 15000 });

    await supportButton.click();
    const modal = page.locator(".cp-support-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Dukungan untuk");
    await page.locator('input[aria-label="Jumlah dukungan C-Coin"]').fill("1");
    await modal.locator("button.btn-gold").click();

    // Spend action — in-app confirm (D8) wajib muncul sebelum API dipanggil.
    const confirmCard = page.locator(".cfm-card");
    await expect(confirmCard).toContainText("Kirim dukungan 1 C?");
    const sendButton = confirmCard.locator("button:has-text('Kirim')");
    await expect(sendButton).toBeDisabled();
    await confirmCard.getByRole("checkbox").check();
    await sendButton.click();

    await expect(page.locator(".toast-success").filter({ hasText: "Dukungan 1 C terkirim" })).toBeVisible();

    // DB truth dual-token (docs/07): pengirim -1 C-Coin; kreator +1 C-GEMS
    // (send_support → wallet_credit_gems, ccoin kreator tidak berubah); XP
    // includes the 1 C spend plus any newly unlocked badge reward.
    expect(await readBalance(rest, DEMO_ID)).toBe(demoBalanceBefore - 1);
    expect(await readGemsBalance(rest, CREATOR_ID)).toBe(creatorGemsBefore + 1);
    expect(await readBalance(rest, CREATOR_ID)).toBe(creatorBalanceBefore);
    const demoBadgeXpAfter = await readBadgeXp(rest, DEMO_ID);
    expect(await readTotalXp(rest, DEMO_ID)).toBe(demoXpBefore + 1 + demoBadgeXpAfter - demoBadgeXpBefore);
  });

  test("Pemenang: drop selesai menampilkan nomor kartu + Premium/Regular + nama", async ({ page }) => {
    await page.goto(`/drops/${WINNERS_DROP_ID}`);
    const winnersSection = page.locator("section.dd-winners");
    await expect(winnersSection).toBeVisible({ timeout: 15000 });
    await expect(winnersSection.locator("h2")).toContainText("Pemenang");

    const rows = winnersSection.locator("li.dd-winner-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    await expect(rows.first().locator(".dd-winner-unit")).toHaveText(/^#\d+$/);
    // Seed: unit 10 = kartu signed → baris Premium.
    await expect(rows.filter({ hasText: "#10" }).first()).toContainText("Signed");
    await expect(rows.filter({ hasText: "#10" }).first().locator(".dd-winner-name")).not.toBeEmpty();
  });

  test("Pemenang tetap tampil ketika hasil draw masuk fase FCFS", async ({ page }) => {
    const drop = {
      id: "drop-e2e-fcfs",
      title: "Drop FCFS setelah draw",
      series: "E2E",
      narrative: "Fixture hasil draw yang masih memiliki unit FCFS.",
      artworkUrl: "",
      totalUnits: 2,
      signedCount: 0,
      unsignedCount: 2,
      priceCcoin: 30,
      priceUnsignedCCoin: 30,
      priceSignedCCoin: 50,
      status: "live",
      dropStartAt: "2026-01-01T05:00:00.000Z",
      dropEndAt: "2099-01-01T05:00:00.000Z",
      raffleEndAt: "2026-01-02T05:00:00.000Z",
      drawnAt: "2026-01-02T05:01:00.000Z",
      creatorId: "creator-e2e",
      creatorName: "Creator E2E",
      soldCount: 1,
      createdAt: "2026-01-01T05:00:00.000Z",
      isSeed: false,
      winners: [{ unitNumber: 1, variant: "unsigned", displayName: "Pemenang E2E" }],
    };
    await page.route("**/api/drops/drop-e2e-fcfs", (route) => route.fulfill({ json: drop }));
    await page.route("**/api/drops/drop-e2e-fcfs/cards", (route) =>
      route.fulfill({ json: { cards: [{ id: "card-e2e-fcfs-1", unitNumber: 1, variant: "unsigned", status: "bound", isOwned: true }] } }),
    );
    await page.goto("/drops/drop-e2e-fcfs");
    await expect(page.locator("section.dd-winners")).toContainText("Pemenang E2E", { timeout: 10000 });
    await expect(page.locator("a.cm-cta", { hasText: "Beli Sekarang" })).toBeVisible();
  });
});
