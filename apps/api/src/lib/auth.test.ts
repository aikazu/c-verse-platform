import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { type SupabaseJwtConfig, verifySupabaseJwt } from "./auth";

// Matriks docs/15 §3.2: JWT expired / tampered / aud salah -> ditolak verifier (=> 401 di route).

const ISSUER = "https://test.supabase.co";
const SUB = "00000000-0000-0000-0000-00000000aaaa";

async function makeConfig() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] };
  const config: SupabaseJwtConfig = { issuer: ISSUER, jwks: jwks };
  const sign = (opts?: { sub?: string; aud?: string | string[]; issuer?: string; exp?: number }) =>
    new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(opts?.sub ?? SUB)
      .setAudience(opts?.aud ?? "authenticated")
      .setIssuer(opts?.issuer ?? ISSUER)
      .setExpirationTime(opts?.exp ?? "2h")
      .sign(privateKey);
  return { config, sign };
}

describe("verifySupabaseJwt", () => {
  it("accepts a valid token and returns sub", async () => {
    const { config, sign } = await makeConfig();
    const token = await sign();
    expect(await verifySupabaseJwt(token, config)).toEqual({ sub: SUB });
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
