import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type SupabaseJwtConfig, tokenFingerprint, verifySupabaseJwt } from "./auth";

// Matriks docs/15 §3.2: JWT expired / tampered / aud salah -> ditolak verifier (=> 401 di route).

const ISSUER = "https://test.supabase.co";
const SUB = "00000000-0000-0000-0000-00000000aaaa";

async function makeConfig() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] };
  const config: SupabaseJwtConfig = { issuer: ISSUER, jwks: jwks };
  const sign = (opts?: { sub?: string; aud?: string | string[]; issuer?: string; exp?: number; aal?: string }) =>
    new SignJWT({ role: "authenticated", ...(opts?.aal ? { aal: opts.aal } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(opts?.sub ?? SUB)
      .setAudience(opts?.aud ?? "authenticated")
      .setIssuer(opts?.issuer ?? ISSUER)
      .setExpirationTime(opts?.exp ?? "2h")
      .sign(privateKey);
  return { config, sign };
}

describe("verifySupabaseJwt", () => {
  it("accepts a valid token and returns sub + aal (null when claim absent)", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign();
    expect(await verifySupabaseJwt(token, config)).toEqual({ sub: SUB, aal: null });
  });

  it("extracts the aal claim when present (MFA level)", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign({ aal: "aal2" });
    expect(await verifySupabaseJwt(token, config)).toEqual({ sub: SUB, aal: "aal2" });
  });

  it("rejects an expired token", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign({ exp: 0 });
    expect(await verifySupabaseJwt(token, config)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign();
    const tampered = `${token.slice(0, -6)}abcdef`;
    expect(await verifySupabaseJwt(tampered, config)).toBeNull();
  });

  it("rejects wrong audience", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign({ aud: "anon" });
    expect(await verifySupabaseJwt(token, config)).toBeNull();
  });

  it("rejects wrong issuer", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign({ issuer: "https://evil.example.com" });
    expect(await verifySupabaseJwt(token, config)).toBeNull();
  });

  it("rejects garbage input", async () => {
    const { config } = await makeConfig();
    expect(await verifySupabaseJwt("not-a-jwt", config)).toBeNull();
    expect(await verifySupabaseJwt("", config)).toBeNull();
  });
});

describe("tokenFingerprint", () => {
  it("returns a stable sha256 fingerprint, never the raw token", async () => {
    const header = "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.payload.sig";
    const fp = await tokenFingerprint(header);
    expect(fp).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(fp).not.toContain("eyJ");
    expect(await tokenFingerprint(header)).toBe(fp); // deterministic
  });

  it("returns null when no token is present", async () => {
    expect(await tokenFingerprint(undefined)).toBeNull();
  });
});

describe("supabaseIssuerFromUrl", () => {
  it("appends /auth/v1 — GoTrue iss includes the auth path (regression: base URL was rejected by jwtVerify)", async () => {
    const { supabaseIssuerFromUrl } = await import("./auth");
    expect(supabaseIssuerFromUrl("https://x.supabase.co")).toBe("https://x.supabase.co/auth/v1");
    expect(supabaseIssuerFromUrl("http://127.0.0.1:54321/")).toBe("http://127.0.0.1:54321/auth/v1");
  });

  it("returns null for missing or non-http URL", async () => {
    const { supabaseIssuerFromUrl } = await import("./auth");
    expect(supabaseIssuerFromUrl(undefined)).toBeNull();
    expect(supabaseIssuerFromUrl("not-a-url")).toBeNull();
  });
});

describe("clientIp", () => {
  // Reused by logAuditDb call sites (H1 forensic integrity): prefer CF-Connecting-IP first
  // because x-forwarded-for is client-spoofable outside the Cloudflare Worker gateway.
  it("prefers cf-connecting-ip (Cloudflare-rendered, trusted)", async () => {
    const { clientIp } = await import("./auth");
    expect(
      clientIp({
        req: {
          header: (k: string) =>
            ({
              "cf-connecting-ip": "203.0.113.5",
              "x-real-ip": "10.0.0.1",
              "x-forwarded-for": "1.2.3.4, 10.0.0.2",
            })[k.toLowerCase()],
        },
      }),
    ).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when cf-connecting-ip is missing", async () => {
    const { clientIp } = await import("./auth");
    expect(
      clientIp({
        req: {
          header: (k: string) =>
            ({
              "x-real-ip": "10.0.0.7",
              "x-forwarded-for": "1.2.3.4",
            })[k.toLowerCase()],
        },
      }),
    ).toBe("10.0.0.7");
  });

  it("takes the first hop from x-forwarded-for when neither cf nor real-ip present", async () => {
    const { clientIp } = await import("./auth");
    expect(
      clientIp({
        req: {
          header: (k: string) => (k.toLowerCase() === "x-forwarded-for" ? "1.2.3.4, 10.0.0.2, 10.0.0.3" : undefined),
        },
      }),
    ).toBe("1.2.3.4");
  });

  it("returns null when no client IP header is present", async () => {
    const { clientIp } = await import("./auth");
    expect(
      clientIp({
        req: { header: () => undefined },
      }),
    ).toBeNull();
  });
});

// P2-6: suspension gate — requireUser resolves issuer+JWKS from SUPABASE_URL env
// (no injected config path) and loads the users row via getSupabase(). Env dipin,
// JWKS endpoint disajikan lewat fetch stub, dan users table di-mock via supabase.js.
const requireUserControl = vi.hoisted(() => ({
  userRow: null as Record<string, unknown> | null,
  dbLookups: [] as Array<{ table: string; id: string }>,
}));

vi.hoisted(() => {
  // Literal (bukan konstanta ISSUER) — vi.hoisted dieksekusi sebelum deklarasi modul.
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "https://test.supabase.co";
});

vi.mock("./supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, id: string) => {
          requireUserControl.dbLookups.push({ table: `${table}.${column}`, id });
          return {
            maybeSingle: () => Promise.resolve({ data: requireUserControl.userRow, error: null }),
          };
        },
      }),
    }),
  }),
}));

describe("requireUser suspension gate (P2-6: 401 invalid vs 403 suspended)", () => {
  // GoTrue issuer = <SUPABASE_URL>/auth/v1 — token harus di-signing dengan issuer
  // env-derived ini, dan JWKS disajikan di <issuer>/.well-known/jwks.json.
  const ENV_ISSUER = `${ISSUER}/auth/v1`;
  const JWKS_URL = `${ENV_ISSUER}/.well-known/jwks.json`;
  let originalFetch: typeof fetch;
  // Satu keypair untuk seluruh describe: createRemoteJWKSet di-cache module-level
  // (auth.ts) — keypair baru per-test dengan kid sama akan gagal verifikasi dari cache.
  let jwtKit: Awaited<ReturnType<typeof makeConfig>>;

  const callerFor = (token?: string) => ({
    req: {
      header: (k: string) => (token !== undefined && k.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined),
    },
  });

  const stubJwksFetch = (jwks: { keys: JWK[] }) => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      if (href === JWKS_URL) {
        return new Response(JSON.stringify(jwks), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected network call in test: ${href}`);
    }) as typeof fetch;
  };

  beforeAll(async () => {
    jwtKit = await makeConfig();
  });
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    stubJwksFetch(jwtKit.config.jwks);
    requireUserControl.userRow = null;
    requireUserControl.dbLookups = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("valid JWT but user row has flag_reason -> 403 { reason: 'suspended' }, after DB lookup by JWT sub", async () => {
    const { requireUser } = await import("./auth");
    requireUserControl.userRow = { id: SUB, email: "member@cverse.id", flag_reason: "fraud" };
    const res = await requireUser(callerFor(await jwtKit.sign({ issuer: ENV_ISSUER })));
    expect(res).toEqual({ error: 403, reason: "suspended" });
    // Row lookup must use the token's sub — proves the rejection happened AFTER
    // successful JWT verification, purely because of flag_reason.
    expect(requireUserControl.dbLookups).toEqual([{ table: "users.id", id: SUB }]);
  });

  it("valid JWT with clean row -> resolves user (proves the 403 is flag_reason-specific)", async () => {
    const { requireUser } = await import("./auth");
    requireUserControl.userRow = { id: SUB, email: "member@cverse.id", flag_reason: null, role: "user" };
    const token = await jwtKit.sign({ issuer: ENV_ISSUER });
    const res = await requireUser(callerFor(token));
    if ("error" in res) throw new Error(`expected success, got ${JSON.stringify(res)}`);
    expect(res.user.id).toBe(SUB);
    expect(res.user.flagReason).toBeNull();
    expect(res.token).toBe(token);
    expect(requireUserControl.dbLookups).toHaveLength(1);
  });

  it("tampered JWT -> 401 without touching the users table", async () => {
    const { requireUser } = await import("./auth");
    requireUserControl.userRow = { id: SUB, flag_reason: null };
    const token = await jwtKit.sign({ issuer: ENV_ISSUER });
    const res = await requireUser(callerFor(`${token.slice(0, -4)}beef`));
    expect(res).toEqual({ error: 401 });
    expect(requireUserControl.dbLookups).toHaveLength(0);
  });

  it("missing Authorization header -> 401 without touching the users table", async () => {
    const { requireUser } = await import("./auth");
    const res = await requireUser(callerFor(undefined));
    expect(res).toEqual({ error: 401 });
    expect(requireUserControl.dbLookups).toHaveLength(0);
  });
});
