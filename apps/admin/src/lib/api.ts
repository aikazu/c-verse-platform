import { supabase } from "./supabase";

// Empty = same-origin through the Cloudflare Worker gateway. Local development
// may still set a direct API base in .env.local.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body != null && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

async function throwApiError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const message = body?.error;
  if (res.status === 401) {
    await supabase.auth.signOut();
    throw new Error("Sesi berakhir — silakan masuk kembali.");
  }
  throw new Error(message ?? `HTTP ${res.status} ${res.statusText}`);
}

// Single shared fetch helper for the role-gated admin API: prepends API_BASE,
// attaches the current Supabase session token, and surfaces the server `error`
// field on non-2xx. All admin MUTATIONS must go through here so they are
// audited server-side — direct anon-key writes are silently denied by RLS.
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorizedFetch(path, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // The body is already consumed, so preserve its server message while using
    // the shared auth-expiry behavior.
    const message = (body as { error?: string } | null)?.error;
    const replay = new Response(JSON.stringify({ error: message }), { status: res.status, statusText: res.statusText });
    return throwApiError(replay);
  }
  return body as T;
}

/** Fetch an audited private document without exposing its R2 object key. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const res = await authorizedFetch(path, {});
  if (!res.ok) return throwApiError(res);
  return res.blob();
}
