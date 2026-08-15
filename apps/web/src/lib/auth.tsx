import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { api, clearToken, saveToken } from "./api";

type User = { id: string; email: string; displayName: string; role: string; xp?: number } | null;

const AuthCtx = createContext<{
  user: User;
  token: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string, name: string) => Promise<void>;
  demoLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  demoLogin: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = api.getToken();
    setToken(t);
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => setUser({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, xp: u.xp }))
      .catch(() => {
        clearToken();
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);
  async function login(email: string, password: string) {
    const r = await api.login(email, password);
    saveToken(r.token);
    setToken(r.token);
    setUser({ id: r.user.id, email: r.user.email, displayName: r.user.displayName, role: r.user.role });
  }
  async function register(email: string, password: string, displayName: string) {
    const r = await api.register(email, password, displayName);
    saveToken(r.token);
    setToken(r.token);
    setUser({ id: r.user.id, email: r.user.email, displayName: r.user.displayName, role: r.user.role });
  }
  async function demoLogin() {
    const r = await api.demoLogin();
    saveToken(r.token);
    setToken(r.token);
    setUser({ id: r.user.id, email: r.user.email, displayName: r.user.displayName, role: r.user.role });
  }
  async function logout() {
    try {
      await api.logout();
    } catch {}
    clearToken();
    setToken(null);
    setUser(null);
  }
  async function refresh() {
    try {
      const u = await api.me();
      setUser({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, xp: u.xp });
    } catch {}
  }
  return <AuthCtx.Provider value={{ user, token, loading, login, register, demoLogin, logout, refresh }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
