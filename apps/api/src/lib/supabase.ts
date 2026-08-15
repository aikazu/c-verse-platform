import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null | undefined; // undefined = not yet checked

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

/**
 * Returns Supabase client if env is configured, else null.
 * Branch-aware: Supabase Branching injects per-branch URL/keys via env/Secrets.
 * Fallback path: caller should use in-memory store (store.ts) when null.
 * Optional `env` (Workers bindings / scheduled handler) takes precedence over globals.
 */
export function getSupabase(env?: EnvLike): SupabaseClient | null {
  if (env?.SUPABASE_URL?.startsWith("http")) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
    if (key) return createClient(env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  if (_client !== undefined) return _client;
  const url = envValue("SUPABASE_URL", env) ?? getEnv("VITE_SUPABASE_URL");
  const anonKey = envValue("SUPABASE_ANON_KEY", env) ?? getEnv("VITE_SUPABASE_ANON_KEY");
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env);

  // Prefer service_role on server (bypasses RLS for MVP); anon on client
  const key = serviceKey ?? anonKey;

  if (!url || !key) {
    _client = null;
    return _client;
  }

  // Validate URL shape to avoid noisy errors when only placeholder is set
  if (!url.startsWith("http")) {
    console.warn("[supabase] SUPABASE_URL looks invalid, skipping:", url);
    _client = null;
    return _client;
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** True when DB is wired (branch/production); false = in-memory fallback active. */
export function isSupabaseEnabled(): boolean {
  return getSupabase() !== null;
}

/** For tests / hot-reload: reset cached client so env change is picked up. */
export function _resetSupabaseCache() {
  _client = undefined;
}
