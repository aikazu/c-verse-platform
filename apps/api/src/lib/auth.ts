import { createLocalJWKSet, createRemoteJWKSet, type JWK, jwtVerify } from "jose";
import type { User } from "./store.js";
import { getSupabase } from "./supabase.js";

// Supabase Auth JWT middleware (docs/10 §3.3) — verify Supabase JWT (JWKS),
// sub = users.id (uuid). DB wajib: tanpa Supabase tidak ada sesi fallback.

export interface SupabaseJwtConfig {
  issuer: string;
  jwks: { keys: JWK[] };
}

let cachedRemoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

/** GoTrue iss = <SUPABASE_URL>/auth/v1 — issuer tanpa suffix akan ditolak jwtVerify. */
export function supabaseIssuerFromUrl(url: string | undefined): string | null {
  if (!url?.startsWith("http")) return null;
  return `${url.replace(/\/+$/, "")}/auth/v1`;
}

function supabaseIssuer(): string | null {
  return supabaseIssuerFromUrl(getEnv("SUPABASE_URL"));
}

function getRemoteJwks(issuer: string) {
  if (!cachedRemoteJwks) {
    cachedRemoteJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return cachedRemoteJwks;
}

/** Verify a Supabase JWT. Returns { sub } (= users.id) or null. Injectable config for tests. */
export async function verifySupabaseJwt(token: string, injected?: SupabaseJwtConfig): Promise<{ sub: string } | null> {
  const issuer = injected?.issuer ?? supabaseIssuer();
  if (!issuer) return null;
  try {
    const key = injected ? createLocalJWKSet(injected.jwks) : getRemoteJwks(issuer);
    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

function dbUserToStoreUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    displayName: String(row.display_name ?? row.display_name ?? "Pengguna"),
    username: (row.username as string | null) ?? null,
    role: (row.role as User["role"]) ?? "user",
    avatarUrl: (row.avatar_url as string | null) ?? null,
    xp: Number(row.total_xp ?? 0),
    totalXp: Number(row.total_xp ?? 0),
    level: Number(row.level ?? 1),
    cumulativeSpendCcoin: Number(row.cumulative_spend_ccoin ?? 0),
    isAnonymous: Boolean(row.is_anonymous ?? false),
    flagReason: (row.flag_reason as string | null) ?? null,
    consentAnalyticsDetail: Boolean(row.consent_analytics_detail ?? false),
    consentDataMarket: Boolean(row.consent_data_market ?? false),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    passwordHash: "",
  };
}

export type RequireUserResult = { user: User; token: string } | { error: 401 } | { error: 403; reason: "suspended" };

/** Extract the bearer token from an Authorization header value. */
export function authHeaderToToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : authHeader;
}

/**
 * Resolve the caller from `Authorization: Bearer <token>` — verify Supabase JWT,
 * load users row by sub (401 invalid, 403 suspended). Misconfigured Supabase
 * throws (fail-fast — no in-memory session fallback anymore).
 */
export async function requireUser(c: { req: { header: (k: string) => string | undefined } }): Promise<RequireUserResult> {
  const token = authHeaderToToken(c.req.header("authorization"));
  if (!token) return { error: 401 };
  // (token kept for RPC calls that forward the user JWT)

  const issuer = supabaseIssuer();
  const supabase = getSupabase();
  if (!issuer) throw new Error("SUPABASE_URL tidak terkonfigurasi — auth butuh Supabase (fail-fast).");
  const verified = await verifySupabaseJwt(token);
  if (!verified) return { error: 401 };
  const { data, error } = await supabase.from("users").select("*").eq("id", verified.sub).maybeSingle();
  if (error || !data) return { error: 401 };
  const user = dbUserToStoreUser(data as Record<string, unknown>);
  if (user.flagReason) return { error: 403, reason: "suspended" };
  return { user, token };
}
