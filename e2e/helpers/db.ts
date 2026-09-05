import { readFileSync } from "node:fs";
import path from "node:path";
import { remoteSupabaseConfig } from "../env";

/**
 * Helper DB untuk fixture e2e yang butuh mutasi data langsung (bukan via UI/API).
 *
 * Akses PostgREST via fetch + SUPABASE_SERVICE_ROLE_KEY — pola yang sama dengan
 * e2e/specs/admin/03-admin-ops.spec.ts. @supabase/supabase-js TIDAK ada di deps
 * root (hanya deps apps/web), jadi createClient tidak resolvable dari e2e/;
 * untuk satu UPDATE, REST langsung setara tanpa dependency baru.
 *
 * Kredensial remote diambil dari environment E2E, tidak pernah di-hardcode atau
 * di-echo. Fallback `.dev.vars` hanya kompatibilitas caller lama; helper mutasi
 * selalu memvalidasi project remote sebelum request pertama.
 */

const DEV_VARS_PATH = "apps/api/.dev.vars";

export interface RemoteServiceRest {
  base: string;
  headers: Record<string, string>;
}

/** Service-role REST client yang selalu mengikat request ke project E2E remote. */
export function remoteServiceRest(): RemoteServiceRest {
  const remote = remoteSupabaseConfig();
  return {
    base: remote.supabaseUrl,
    headers: {
      apikey: remote.serviceRoleKey,
      Authorization: `Bearer ${remote.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

/** Baca runtime `E2E_*`/env lebih dulu, lalu fallback legacy `.dev.vars`. */
export function readDevVar(key: string): string | null {
  const envValue = process.env[`E2E_${key}`]?.trim() || process.env[key]?.trim();
  if (envValue) return envValue;
  let raw: string;
  try {
    raw = readFileSync(path.resolve(process.cwd(), DEV_VARS_PATH), "utf8");
  } catch {
    return null; // fallback legacy absen — runner E2E remote memakai environment
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
  try {
    remoteSupabaseConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Backdate `created_at` semua bid AKTIF pada satu kartu (lokal SAJA — service
 * role). Dipakai spec bid untuk melompati cooldown cancel 24h (founder
 * 2026-09-01): bid segar terkunci di UI, jadi sebelum cancel via UI, bid di-
 * backdate ke masa lalu agar cooldown dianggap lewat. Melempar jika REST gagal.
 */
export async function backdateActiveBids(cardId: string, hoursAgo: number): Promise<void> {
  const rest = remoteServiceRest();
  const createdAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${rest.base}/rest/v1/bids?card_id=eq.${encodeURIComponent(cardId)}&status=eq.active`, {
    method: "PATCH",
    headers: {
      ...rest.headers,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ created_at: createdAt }),
  });
  if (!res.ok) {
    // Detail respons TIDAK di-echo (bisa berisi potongan internal) — cukup status.
    throw new Error(`backdateActiveBids gagal: HTTP ${res.status}`);
  }
}
