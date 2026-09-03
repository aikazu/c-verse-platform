import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setApiToken } from "./api";
import type { ApiUser } from "./api-types";
import { shouldClearCache } from "./auth-cache";
import { isSupabaseEnabled, supabase } from "./supabase";

// Auth (docs/10): Supabase Auth — Google OAuth + email OTP 6 digit + captcha Turnstile.
// DB wajib — demo-login in-memory dihapus bersama fallback store di API.

// Tracker viewer terakhir (module-level: id user sesi yang baru saja terlihat).
// `undefined` = belum ada observasi (initial load) — observasi pertama hanya
// mengisi, sehingga refresh halaman dengan sesi lama tidak meng-clear cache.
let lastViewerUserId: string | null | undefined;

/**
 * Catat id user sesi terbaru; clear React Query cache hanya saat viewer BERGANTI
 * (payload owner.isOwner / activeBid.isMine adalah viewer-scoped — jangan dilayani
 * ke user lain). Token refresh user yang sama tidak meng-clear (menjaga UX).
 */
function trackViewerUserId(queryClient: ReturnType<typeof useQueryClient>, nextUserId: string | null): void {
  if (shouldClearCache(lastViewerUserId, nextUserId)) queryClient.clear();
  lastViewerUserId = nextUserId;
}

/** Map GoTrue/DB error mentah ke pesan ramah (duplicate canonical email → login di akun lama). */
export function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  const msg = message.toLowerCase();
  if (msg.includes("duplicate key") || msg.includes("already registered") || msg.includes("23505")) {
    return "Email ini sudah punya akun — silakan masuk dengan email yang sama (magic link / Google).";
  }
  return message || "Terjadi kesalahan";
}

type User = Pick<ApiUser, "id" | "email" | "displayName" | "role" | "username" | "usernameIsAuto"> | null;

interface AuthContextValue {
  user: User;
  token: string | null;
  loading: boolean;
  isSupabaseAuth: boolean;
  loginGoogle: () => Promise<void>;
  sendOtp: (email: string, captchaToken?: string, displayName?: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  verifyMagicLink: (tokenHash: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  isSupabaseAuth: false,
  loginGoogle: async () => {},
  sendOtp: async () => {},
  verifyOtp: async () => {},
  verifyMagicLink: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

async function loadProfile(setUser: (u: User) => void, token: string | null) {
  setApiToken(token);
  if (!token) {
    setUser(null);
    return;
  }
  try {
    const u = await api.me();
    setUser({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      username: u.username ?? null,
      usernameIsAuto: u.usernameIsAuto ?? false,
    });
  } catch {
    setUser(null);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const isConfigured = isSupabaseEnabled && !!supabase;

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseEnabled || !sb) return; // config error is rendered below — never fake a session
    sb.auth
      .getSession()
      .then(async ({ data }) => {
        trackViewerUserId(queryClient, data.session?.user.id ?? null);
        const t = data.session?.access_token ?? null;
        setToken(t);
        await loadProfile(setUser, t);
      })
      .finally(() => setLoading(false));
    const { data: sub } = sb.auth.onAuthStateChange(async (_event, session) => {
      trackViewerUserId(queryClient, session?.user.id ?? null);
      const t = session?.access_token ?? null;
      setToken(t);
      await loadProfile(setUser, t);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loginGoogle() {
    if (!supabase) throw new Error("Supabase belum terkonfigurasi");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async function sendOtp(email: string, captchaToken?: string, displayName?: string) {
    if (!supabase) throw new Error("Supabase belum terkonfigurasi");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken,
        shouldCreateUser: true,
        data: displayName ? { full_name: displayName } : undefined,
      },
    });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async function verifyOtp(email: string, code: string) {
    if (!supabase) throw new Error("Supabase belum terkonfigurasi");
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw new Error(friendlyAuthError(error));
    trackViewerUserId(queryClient, data.session?.user.id ?? null);
  }

  // Demo lokal (masa demo): tukar token_hash dari POST /api/auth/demo-login menjadi sesi.
  async function verifyMagicLink(tokenHash: string) {
    if (!supabase) throw new Error("Supabase belum terkonfigurasi");
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) throw new Error(friendlyAuthError(error));
    trackViewerUserId(queryClient, data.session?.user.id ?? null);
  }

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    trackViewerUserId(queryClient, null); // reset tracker — viewer sudah pergi
    setApiToken(null);
    setToken(null);
    setUser(null);
    queryClient.clear(); // drop cached data of the signed-out user
  }

  async function refresh() {
    await loadProfile(setUser, token);
  }

  // value stabil antar-render — konsumen useAuth tidak ikut re-render saat state lain berubah
  const ctxValue = useMemo(
    () => ({ user, token, loading, isSupabaseAuth: isSupabaseEnabled, loginGoogle, sendOtp, verifyOtp, verifyMagicLink, logout, refresh }),
    [user, token, loading, loginGoogle, sendOtp, verifyOtp, verifyMagicLink, logout, refresh],
  );

  // Early return setelah semua hook — tanpa Supabase tidak ada sesi palsu (fail-fast).
  if (!isConfigured) {
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32, margin: "0 auto", maxWidth: 480 }}>
        <span className="eyebrow">Konfigurasi</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Supabase belum terkonfigurasi — set <span style={{ fontFamily: "var(--font-mono)" }}>VITE_SUPABASE_URL</span> dan{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>VITE_SUPABASE_ANON_KEY</span> di{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>.env.local</span>.
        </p>
      </div>
    );
  }

  return <AuthCtx.Provider value={ctxValue}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
