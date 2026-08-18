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

/** Verify a Supabase JWT. Returns { sub, aal } (sub = users.id) or null. Injectable config for tests. */
export async function verifySupabaseJwt(token: string, injected?: SupabaseJwtConfig): Promise<{ sub: string; aal: string | null } | null> {
  const issuer = injected?.issuer ?? supabaseIssuer();
  if (!issuer) return null;
  try {
    const key = injected ? createLocalJWKSet(injected.jwks) : getRemoteJwks(issuer);
    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience: "authenticated",
      // Pin to Supabase's asymmetric signing algorithms — never accept HS*/none (key-confusion).
      algorithms: ["RS256", "ES256"],
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { sub: payload.sub, aal: typeof payload.aal === "string" ? payload.aal : null };
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
    usernameIsAuto: Boolean(row.username_is_auto ?? false),
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
  };
}

export type RequireUserResult = { user: User; token: string; aal: string | null } | { error: 401 } | { error: 403; reason: "suspended" };

/** Extract the bearer token from an Authorization header value. */
export function authHeaderToToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : authHeader;
}

/**
 * Non-reversible fingerprint of a bearer token for audit correlation — NEVER store
 * the raw JWT (replayable until expiry). SHA-256, truncated to 16 hex chars.
 */
export async function tokenFingerprint(authHeader: string | undefined): Promise<string | null> {
  const token = authHeaderToToken(authHeader);
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest).subarray(0, 8);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
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
  return { user, token, aal: verified.aal };
}

export type RequireAdminResult =
  | { user: User; token: string }
  | { error: 401 }
  | { error: 403; reason: "suspended" | "not_admin" | "mfa_required" };

/**
 * Admin gate: authenticated + role=admin + MFA aal2 (docs: admin behind MFA TOTP).
 * aal2 is enforced SERVER-SIDE here — the admin SPA guard is UX only and bypassable.
 */
export async function requireAdmin(c: { req: { header: (k: string) => string | undefined } }): Promise<RequireAdminResult> {
  const res = await requireUser(c);
  if ("error" in res) return res;
  if (res.user.role !== "admin") return { error: 403, reason: "not_admin" };
  if (res.aal !== "aal2") return { error: 403, reason: "mfa_required" };
  return { user: res.user, token: res.token };
}

/** Map a requireAdmin error result to a body + status for `c.json(body, status)`. */
export function adminGateError(res: { error: 401 | 403; reason?: string }): { body: { error: string }; status: 401 | 403 } {
  if (res.error === 401) return { body: { error: "Unauthorized" }, status: 401 };
  const msg =
    res.reason === "mfa_required" ? "MFA (aal2) wajib untuk aksi admin" : res.reason === "suspended" ? "Akun disuspend" : "Hanya admin";
  return { body: { error: msg }, status: 403 };
}
