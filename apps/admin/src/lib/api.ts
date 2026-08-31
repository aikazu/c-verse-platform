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
    // Audit batch 3 (lane I): sesi yang tidak lagi layak memanggil admin API
    // keluar ke login — signOut membuat session null, dan App.tsx otomatis
    // merender LoginPage via onAuthStateChange (tanpa navigasi manual).
    //   401 = token expired/invalid.
    //   403 "MFA (aal2) wajib untuk aksi admin" = kredensial tidak cukup
    //     (adminGateError di apps/api/src/lib/auth.ts). Prod-only: di dev sesi
    //     demo login memang aal1 — branch ini kalau aktif akan memaksa logout
    //     di panggilan admin API pertama dan mematikan bench dev (dan e2e
    //     03-admin-ops yang mem-pin pesan MFA tampil di UI).
    const isMfaRequired = res.status === 403 && message === "MFA (aal2) wajib untuk aksi admin";
    if (res.status === 401 || (isMfaRequired && import.meta.env.PROD)) {
      await supabase.auth.signOut();
      throw new Error("Sesi berakhir — silakan masuk kembali.");
    }
    throw new Error(message ?? `HTTP ${res.status} ${res.statusText}`);
  }
  return body as T;
}
