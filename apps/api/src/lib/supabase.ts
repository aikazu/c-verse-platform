import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null | undefined; // undefined = not yet checked

function getEnv(name: string): string | undefined {
  // Wrangler / Workers: `globalThis` may have env injected; also check process.env for Node
  const g: any = globalThis as any;
  return (
    g?.[name] ??
    (typeof process !== "undefined" ? (process as any).env?.[name] : undefined) ??
    undefined
  );
}

/**
 * Returns Supabase client if env is configured, else null.
 * Branch-aware: Supabase Branching injects per-branch URL/keys via env/Secrets.
 * Fallback path: caller should use in-memory store (store.ts) when null.
 */
export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? getEnv("VITE_SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

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
