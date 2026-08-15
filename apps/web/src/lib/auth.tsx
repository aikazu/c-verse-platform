import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, setApiToken } from "./api";
import { isSupabaseEnabled, supabase } from "./supabase";

// Auth (docs/10): Supabase Auth — Google OAuth + email OTP 6 digit + captcha Turnstile.
// DB wajib — demo-login in-memory dihapus bersama fallback store di API.

type User = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  username?: string | null;
  usernameIsAuto?: boolean;
  xp?: number;
} | null;

interface AuthContextValue {
  user: User;
  token: string | null;
  loading: boolean;
  isSupabaseAuth: boolean;
  loginGoogle: () => Promise<void>;
  sendOtp: (email: string, captchaToken?: string, displayName?: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
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
      xp: u.xp,
    });
  } catch {
    setUser(null);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) {
      // dev fallback: demo token di localStorage
      const t = api.getToken();
      setToken(t);
      loadProfile(setUser, t).finally(() => setLoading(false));
      return;
    }
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const t = data.session?.access_token ?? null;
        setToken(t);
        await loadProfile(setUser, t);
      })
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
    if (error) throw error;
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
    if (error) throw error;
  }

  async function verifyOtp(email: string, code: string) {
    if (!supabase) throw new Error("Supabase belum terkonfigurasi");
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw error;
  }

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    clearToken();
    setApiToken(null);
    setToken(null);
    setUser(null);
  }

  async function refresh() {
    await loadProfile(setUser, token);
  }

  // value stabil antar-render — konsumen useAuth tidak ikut re-render saat state lain berubah
  const ctxValue = useMemo(
    () => ({ user, token, loading, isSupabaseAuth: isSupabaseEnabled, loginGoogle, sendOtp, verifyOtp, logout, refresh }),
    [user, token, loading, loginGoogle, sendOtp, verifyOtp, logout, refresh],
  );

  return <AuthCtx.Provider value={ctxValue}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
