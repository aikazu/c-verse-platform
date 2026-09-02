import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Helper DB untuk fixture e2e yang butuh mutasi data langsung (bukan via UI/API).
 *
 * Akses PostgREST via fetch + SUPABASE_SERVICE_ROLE_KEY — pola yang sama dengan
 * e2e/specs/admin/03-admin-ops.spec.ts. @supabase/supabase-js TIDAK ada di deps
 * root (hanya deps apps/web), jadi createClient tidak resolvable dari e2e/;
 * untuk satu UPDATE, REST langsung setara tanpa dependency baru.
 *
 * Aturan repo: kunci HANYA lewat env — dibaca dari apps/api/.dev.vars (gitignored),
 * tidak pernah di-hardcode dan tidak pernah di-echo. File/key absen → helper
 * melaporkan "tidak tersedia" (graceful) dan spec yang bergantung pada fixture
 * ini melakukan test.skip dengan alasan eksplisit.
 */

const DEV_VARS_PATH = "apps/api/.dev.vars";

/** Baca satu variabel dari apps/api/.dev.vars — null jika file/key absen/kosong. */
export function readDevVar(key: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path.resolve(process.cwd(), DEV_VARS_PATH), "utf8");
  } catch {
    return null; // .dev.vars absen (gitignored) — bench tanpa file env owner
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (match && match[1] === key) {
      const value = match[2].trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** True bila helper DB bisa jalan (SUPABASE_URL + service role key terbaca). */
export function isDbFixtureAvailable(): boolean {
  return readDevVar("SUPABASE_URL") !== null && readDevVar("SUPABASE_SERVICE_ROLE_KEY") !== null;
}

/** Kredensial REST lokal — sudah diverifikasi ada (pemanggil cek isDbFixtureAvailable). */
function restCredentials(): { supabaseUrl: string; serviceKey: string } {
  const supabaseUrl = readDevVar("SUPABASE_URL");
  const serviceKey = readDevVar("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Kredensial DB tidak ada di apps/api/.dev.vars");
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceKey };
}

/** Header REST service-role (pola sama dengan backdateActiveBids). */
function restHeaders(): Record<string, string> {
  const { serviceKey } = restCredentials();
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

/**
 * Kredit C-Gems TERKUNCI untuk satu user via RPC `wallet_credit_gems`
 * (p_matured=false → lot `mature_at = now() + 24 jam`) — jalur produksi
 * yang sama dengan royalty/support, jadi lot + gem_transactions + wallets
 * terisi atomik di SQL. Returns balance_gems SEBELUM kredit (untuk restore).
 * RPC ini revoke dari public/anon/authenticated, grant ke service_role
 * (04_rpc.sql) — makanya butuh service key.
 */
export async function creditLockedGemsFixture(userId: string, amount: number, refId: string): Promise<number> {
  const { supabaseUrl } = restCredentials();
  const readRes = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}&select=balance_gems`, {
    headers: restHeaders(),
  });
  if (!readRes.ok) throw new Error(`creditLockedGemsFixture read gagal: HTTP ${readRes.status}`);
  const rows = (await readRes.json()) as Array<{ balance_gems: number }>;
  const before = rows[0]?.balance_gems;
  if (typeof before !== "number") throw new Error(`wallets row untuk ${userId} tidak ditemukan`);

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/wallet_credit_gems`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({
      p_user: userId,
      p_amount: amount,
      p_ref_type: "e2e-fixture",
      p_ref_table: "e2e",
      p_ref_id: refId,
      p_idem: refId,
      p_matured: false,
    }),
  });
  if (!res.ok) throw new Error(`creditLockedGemsFixture gagal: HTTP ${res.status}`);
  return before;
}

/**
 * Rollback fixture locked gems: lot fixture di-nol-kan (remaining=0; gem_lots
 * TIDAK punya trigger immutable) + wallets.balance_gems dikembalikan absolut.
 * gem_transactions append-only (guard) → baris tx fixture TIDAK bisa dihapus
 * dan jadi leftover kecil yang dideklarasikan di report (pola yang sama dengan
 * fixture top-up 11-transfer-buyout). Tidak mempengaruhi reads runtime:
 * gemsMatured dihitung dari lots, gemsLocked = balanceGems - matured.
 */
export async function restoreGemsBalance(userId: string, gemsBalance: number, refId: string): Promise<void> {
  const { supabaseUrl } = restCredentials();
  const headers = restHeaders();
  const lotRes = await fetch(`${supabaseUrl}/rest/v1/gem_lots?user_id=eq.${userId}&ref_id=eq.${encodeURIComponent(refId)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ remaining: 0 }),
  });
  if (!lotRes.ok) throw new Error(`restoreGemsBalance lot gagal: HTTP ${lotRes.status}`);
  const balRes = await fetch(`${supabaseUrl}/rest/v1/wallets?user_id=eq.${userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ balance_gems: gemsBalance }),
  });
  if (!balRes.ok) throw new Error(`restoreGemsBalance wallets gagal: HTTP ${balRes.status}`);
}

/**
 * Backdate `created_at` semua bid AKTIF pada satu kartu (lokal SAJA — service
 * role). Dipakai spec bid untuk melompati cooldown cancel 24h (founder
 * 2026-09-01): bid segar terkunci di UI, jadi sebelum cancel via UI, bid di-
 * backdate ke masa lalu agar cooldown dianggap lewat. Melempar jika REST gagal.
 */
export async function backdateActiveBids(cardId: string, hoursAgo: number): Promise<void> {
  const { supabaseUrl, serviceKey } = restCredentials();
  const createdAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${supabaseUrl}/rest/v1/bids?card_id=eq.${encodeURIComponent(cardId)}&status=eq.active`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ created_at: createdAt }),
  });
  if (!res.ok) {
    // Detail respons TIDAK di-echo (bisa berisi potongan internal) — cukup status.
    throw new Error(`backdateActiveBids gagal: HTTP ${res.status}`);
  }
}
