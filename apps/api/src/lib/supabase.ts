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
 */
export function getSupabase(env?: EnvLike): SupabaseClient {
  if (env?.SUPABASE_URL?.startsWith("http")) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
    if (!key) throw missingDbEnvError();
    return createClient(env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  if (_client !== undefined) return _client;
  const url = envValue("SUPABASE_URL", env) ?? getEnv("VITE_SUPABASE_URL");
  const anonKey = envValue("SUPABASE_ANON_KEY", env) ?? getEnv("VITE_SUPABASE_ANON_KEY");
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env);

  // Prefer service_role on server (bypasses RLS for MVP)
  const key = serviceKey ?? anonKey;

  if (!url || !key || !url.startsWith("http")) throw missingDbEnvError();

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** For tests / hot-reload: reset cached client so env change is picked up. */
export function _resetSupabaseCache() {
  _client = undefined;
}
