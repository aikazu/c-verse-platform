import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
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
  // because x-forwarded-for is client-spoofable when the request bypasses the tunnel.
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
