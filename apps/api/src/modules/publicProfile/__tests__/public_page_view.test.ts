import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_ANON_KEY = "anon-key";
});

const control = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  dbKeys: [] as Array<string>,
  rpcData: null as unknown,
  rpcError: null as { message: string } | null,
  validTokens: new Set<string>(["valid-jwt"]),
  auth: { user: { id: "u-creator-1" }, token: "valid-jwt", aal: "aal1" } as Record<string, unknown>,
}));

vi.mock("../../../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth.js")>();
  return {
    ...actual,
    requireUser: () => Promise.resolve(control.auth),
    authHeaderToToken: (h: string | undefined) => h?.replace(/^Bearer\s+/i, "") ?? null,
    verifySupabaseJwt: (token: string) => Promise.resolve(control.validTokens.has(token) ? { sub: "u-viewer-1", aal: "aal1" } : null),
  };
});

// Real RpcError / wrappers; swap only the transport (userDb) — capture the key
// the route built the client with (user JWT vs anon key) + every rpc call.
vi.mock("../../../lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/db.js")>();
  return {
    ...actual,
    userDb: (key: string) => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        control.dbKeys.push(key);
        control.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: control.rpcData, error: control.rpcError });
      },
    }),
  };
});

const { app } = await import("../../../index.js");

const BASE = "http://localhost/api/public";

function viewRequest(username: string, init: RequestInit & { cf?: Record<string, unknown> } = {}) {
  const req = new Request(`${BASE}/${username}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
    body: JSON.stringify({}),
  });
  // Simulate the Workers-only `cf` property (absent on Node undici Requests).
  if (init.cf) Object.defineProperty(req, "cf", { value: init.cf });
  return req;
}

describe("POST /api/public/:username/view — creator page-view beacon (docs 09 §2.8)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.dbKeys = [];
    control.rpcData = null;
    control.rpcError = null;
  });

  it("anon visitor: 204, RPC record_creator_page_view with host-only referrer + null city, anon-key client", async () => {
    const res = await app.request(
      viewRequest("karina", {
        headers: { referer: "https://www.instagram.com/p/abc123/?utm_source=ig&utm_campaign=x" },
      }),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("record_creator_page_view");
    expect(control.rpcCalls[0]?.args).toEqual({ p_username: "karina", p_referrer_host: "www.instagram.com", p_city: null });
    expect(control.dbKeys).toEqual(["anon-key"]);
  });

  it("logged-in visitor: request JWT forwarded so the RPC sees auth.uid()", async () => {
    const res = await app.request(viewRequest("karina", { headers: { authorization: "Bearer valid-jwt" } }));
    expect(res.status).toBe(204);
    expect(control.dbKeys).toEqual(["valid-jwt"]);
    expect(control.rpcCalls[0]?.args).toEqual({ p_username: "karina", p_referrer_host: null, p_city: null });
  });

  it("invalid/stale JWT reads as anonymous (beacon never fails on auth)", async () => {
    const res = await app.request(viewRequest("karina", { headers: { authorization: "Bearer garbage" } }));
    expect(res.status).toBe(204);
    expect(control.dbKeys).toEqual(["anon-key"]);
  });

  it("no Referer header -> null referrer; Workers cf.city passed through coarse", async () => {
    const res = await app.request(viewRequest("karina", { cf: { city: "Jakarta" } }));
    expect(res.status).toBe(204);
    expect(control.rpcCalls[0]?.args).toEqual({ p_username: "karina", p_referrer_host: null, p_city: "Jakarta" });
  });

  it("unparseable Referer -> null referrer (never raw URL with path/query)", async () => {
    const res = await app.request(viewRequest("karina", { headers: { referer: "not-a-url" } }));
    expect(res.status).toBe(204);
    expect(control.rpcCalls[0]?.args).toEqual({ p_username: "karina", p_referrer_host: null, p_city: null });
  });

  it("client-supplied body fields are ignored — server derives referrer/city", async () => {
    const req = new Request(`${BASE}/karina/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrerHost: "evil.example", city: "Nowhere", p_referrer_host: "evil.example" }),
    });
    const res = await app.request(req);
    expect(res.status).toBe(204);
    expect(control.rpcCalls[0]?.args).toEqual({ p_username: "karina", p_referrer_host: null, p_city: null });
  });

  it("DB transport failure -> 500 with sanitized error (never raw Postgres message)", async () => {
    control.rpcError = { message: "connection to server at 10.0.0.1 refused (schema: public)" };
    const res = await app.request(viewRequest("karina"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("10.0.0.1");
  });
});

describe("GET /api/public/:username/views/stats — creator-only page-view stats (docs 09 §3.5)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.dbKeys = [];
    control.rpcError = null;
    control.rpcData = {
      days: 30,
      total: 42,
      distinct_viewers: 7,
      daily: [{ day: "2026-08-28", views: 12, distinct_viewers: 3 }],
      top_referrers: [{ referrer_host: "instagram.com", views: 9 }],
    };
    control.auth = { user: { id: "u-creator-1" }, token: "valid-jwt", aal: "aal1" };
  });

  it("unauthenticated -> 401 (requireUser first fence)", async () => {
    control.auth = { error: 401 };
    const res = await app.request(`${BASE}/karina/views/stats`);
    expect(res.status).toBe(401);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("suspended -> 403", async () => {
    control.auth = { error: 403, reason: "suspended" };
    const res = await app.request(`${BASE}/karina/views/stats`);
    expect(res.status).toBe(403);
  });

  it("happy path: RPC get_creator_page_stats with default days, payload camelCased", async () => {
    const res = await app.request(`${BASE}/karina/views/stats`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("get_creator_page_stats");
    expect(control.rpcCalls[0]?.args).toEqual({ p_days: 30 });
    expect(control.dbKeys).toEqual(["valid-jwt"]);
    const body = (await res.json()) as { stats: Record<string, unknown> };
    expect(body.stats).toEqual({
      days: 30,
      total: 42,
      distinctViewers: 7,
      daily: [{ day: "2026-08-28", views: 12, distinctViewers: 3 }],
      topReferrers: [{ referrerHost: "instagram.com", views: 9 }],
    });
  });

  it("?days=7 forwarded to the RPC; non-integer/out-of-range rejected 400 before the RPC", async () => {
    const res = await app.request(`${BASE}/karina/views/stats?days=7`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(res.status).toBe(200);
    expect(control.rpcCalls[0]?.args).toEqual({ p_days: 7 });

    control.rpcCalls = [];
    const bad = await app.request(`${BASE}/karina/views/stats?days=9999`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(bad.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("RPC FORBIDDEN fence (caller is not the creator) -> 403", async () => {
    control.rpcError = { message: "FORBIDDEN" };
    const res = await app.request(`${BASE}/karina/views/stats`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Tidak diizinkan");
  });

  it("RPC AUTH_REQUIRED (expired between fences) -> 401", async () => {
    control.rpcError = { message: "AUTH_REQUIRED" };
    const res = await app.request(`${BASE}/karina/views/stats`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(res.status).toBe(401);
  });

  it("DB transport failure -> 500 sanitized", async () => {
    control.rpcError = { message: "violates row-level security policy for table creator_page_views" };
    const res = await app.request(`${BASE}/karina/views/stats`, { headers: { authorization: "Bearer valid-jwt" } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });
});
