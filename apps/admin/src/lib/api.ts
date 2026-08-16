import { supabase } from "./supabase";

// Empty = same-origin (prod, behind the same Cloudflare tunnel); local dev sets
// the local API base in .env.local (see .env.example for the dev default).
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

// Single shared fetch helper for the role-gated admin API: prepends API_BASE,
// attaches the current Supabase session token, and surfaces the server `error`
// field on non-2xx. All admin MUTATIONS must go through here so they are
// audited server-side — direct anon-key writes are silently denied by RLS.
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body != null ? { "Content-Type": "application/json" } : {}),
      ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message ?? `HTTP ${res.status} ${res.statusText}`);
  }
  return body as T;
}
