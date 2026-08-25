import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase DB WAJIB — tidak ada fallback in-memory. Tanpa konfigurasi env,
// modul yang membutuhkan data akan throw (fail-fast) dan entrypoint menolak
// start. Kalau tidak konek DB, API memang tidak boleh jalan.

let _client: SupabaseClient | undefined; // undefined = not yet built

function getEnv(name: string): string | undefined {
  // Wrangler / Workers: `globalThis` may have env injected; also check process.env for Node
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

type EnvLike = Record<string, string | undefined>;

function envValue(name: string, env?: EnvLike): string | undefined {
  return env?.[name] ?? getEnv(name);
}

export function missingDbEnvError(): Error {
  return new Error(
    "Supabase tidak terkonfigurasi — set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (apps/api/.dev.vars untuk lokal, `npx supabase start` dahulu). API tidak jalan tanpa DB.",
  );
}

/**
 * Supabase service client — throws when env is missing (fail-fast, no fallback).
 * Branch-aware: Supabase Branching injects per-branch URL/keys via env/Secrets.
 * Optional `env` (Workers bindings / scheduled handler) takes precedence over globals.
 *
 * M1 (audit 2026-08-24): the server-side service-role key is REQUIRED. Admin route
 * handlers rely on RLS bypass; a silent fallback to the anon key turned a missing
 * or rotated SERVICE_ROLE secret into confusing partial-failure / data leaks.
 */
export function getSupabase(env?: EnvLike): SupabaseClient {
  if (env?.SUPABASE_URL?.startsWith("http")) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw missingDbEnvError();
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  if (_client !== undefined) return _client;
  const url = envValue("SUPABASE_URL", env);
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env);

  if (!url || !serviceKey || !url.startsWith("http")) throw missingDbEnvError();

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** For tests / hot-reload: reset cached client so env change is picked up. */
export function _resetSupabaseCache() {
  _client = undefined;
}
