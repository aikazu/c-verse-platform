import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../helpers";

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

/** Read one variable from apps/api/.dev.vars (null when file/key absent/empty). */
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
    // .dev.vars absent (gitignored)
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

async function restSelect<T>(rest: { base: string; headers: Record<string, string> }, table: string, query: string): Promise<T[]> {
  const res = await fetch(`${rest.base}/rest/v1/${table}?${query}`, { headers: rest.headers });
  if (!res.ok) throw new Error(`REST select ${table} gagal: HTTP ${res.status}`);
  return (await res.json()) as T[];
}

async function readBalance(rest: { base: string; headers: Record<string, string> }, userId: string): Promise<number> {
  const rows = await restSelect<WalletRow>(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_ccoin`);
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_ccoin;
}

/** Dual-token (docs/07): saldo C-Gems kreator (dukungan mengalir sebagai gems). */
async function readGemsBalance(rest: { base: string; headers: Record<string, string> }, userId: string): Promise<number> {
  const rows = await restSelect<{ balance_gems: number }>(rest, "wallets", `user_id=eq.${userId}&select=user_id,balance_gems`);
  if (rows.length !== 1) throw new Error(`Wallet ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].balance_gems;
}

async function readTotalXp(rest: { base: string; headers: Record<string, string> }, userId: string): Promise<number> {
  const rows = await restSelect<UserRow>(rest, "users", `id=eq.${userId}&select=total_xp`);
  if (rows.length !== 1) throw new Error(`User ${userId} tidak tepat 1 baris (${rows.length})`);
  return rows[0].total_xp;
}

/**
 * Shared-bench guard (pola 11-transfer-buyout): top up saldo demo via ledger
 * (append-only INSERT + wallets PATCH) hanya bila kurang dari minBalance.
 */
async function ensureBalance(rest: { base: string; headers: Record<string, string> }, userId: string, minBalance: number): Promise<number> {
  const currentBalance = await readBalance(rest, userId);
  if (currentBalance >= minBalance) return currentBalance;
  const credit = minBalance - currentBalance;
  const insertRes = await fetch(`${rest.base}/rest/v1/wallet_transactions`, {
    method: "POST",
    headers: rest.headers,
    body: JSON.stringify({
      id: `e2e-sup-topup-${Date.now()}`,
      user_id: userId,
      type: "adjustment",
      amount_ccoin: credit,
      balance_after_ccoin: minBalance,
      ref_type: "e2e-fixture",
      ref_id: "13-support-winners",
      note: "e2e fixture top-up — bench bersama, saldo seed terkuras run lane lain",
    }),
  });
  if (!insertRes.ok) throw new Error(`Fixture top-up ledger gagal: HTTP ${insertRes.status}`);
  const patchRes = await fetch(`${rest.base}/rest/v1/wallets?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: rest.headers,
    body: JSON.stringify({ balance_ccoin: minBalance }),
  });
  if (!patchRes.ok) throw new Error(`Fixture top-up wallets gagal: HTTP ${patchRes.status}`);
  return minBalance;
}

/** Login dengan retry (magic-link satu pakai bisa terpakai lane lain di bench bersama). */
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
  const rest: { base: string; headers: Record<string, string> } | null = supabaseRest();

  test("Dukungan: kirim 1 C ke kreator via /c/:handle (transfer penuh + XP pengirim)", async ({ page }) => {
    if (!rest) test.skip(true, "fixture unavailable: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absen di apps/api/.dev.vars");

    const demoBalanceBefore = await ensureBalance(rest, DEMO_ID, 2);
    const creatorBalanceBefore = await readBalance(rest, CREATOR_ID);
    const creatorGemsBefore = await readGemsBalance(rest, CREATOR_ID);
    const demoXpBefore = await readTotalXp(rest, DEMO_ID);

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
    // (send_support → wallet_credit_gems, ccoin kreator tidak berubah); XP +1.
    expect(await readBalance(rest, DEMO_ID)).toBe(demoBalanceBefore - 1);
    expect(await readGemsBalance(rest, CREATOR_ID)).toBe(creatorGemsBefore + 1);
    expect(await readBalance(rest, CREATOR_ID)).toBe(creatorBalanceBefore);
    expect(await readTotalXp(rest, DEMO_ID)).toBe(demoXpBefore + 1);
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
});
