import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  records: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => {
          if (table === "creator_page_views") {
            control.inserted.push({ table, row });
          }
          return {
            select: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          };
        },
        select: () => ({
          eq: () => ({
            ilike: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            // biome-ignore lint/suspicious/noThenProperty: PostgREST builder is thenable
            then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
          }),
        }),
        upsert: () => ({
          select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
      return q;
    },
  }),
  _resetSupabaseCache: () => undefined,
}));

vi.mock("../../lib/reads/creators.js", () => ({
  getCreatorByHandle: () => Promise.resolve({ id: "cr-1", userId: "u-1", handle: "karina" } as never),
  getCreatorByUserId: () => Promise.resolve({ id: "cr-1", userId: "u-1", handle: "karina" } as never),
  listCreators: () => Promise.resolve([] as never[]),
  listCreatorUsers: () => Promise.resolve([] as never[]),
  listCreatorPageViews: () => Promise.resolve([] as never[]),
  recordCreatorPageView: (input: Record<string, unknown>) => {
    control.records.push(input);
    return Promise.resolve();
  },
}));

vi.mock("../../lib/reads/users.js", () => ({
  getUserById: () =>
    Promise.resolve({
      id: "u-1",
      email: "karina@creator.id",
      displayName: "Karina",
      role: "creator",
      username: "karina",
      flagReason: null,
      isAnonymous: false,
    } as never),
  getUserByUsername: () => Promise.resolve(null),
  getUserByUsernameOrId: () => Promise.resolve(null),
}));

vi.mock("../../lib/reads/profiles.js", () => ({
  getUserByUsernameOrId: () => Promise.resolve(null),
  getUserRank: () => Promise.resolve(0),
  listUserBadges: () => Promise.resolve([]),
}));

vi.mock("../../lib/reads/drops.js", () => ({
  getDropById: () => Promise.resolve(null),
  getCardByIdOrNfc: () => Promise.resolve(null),
  listCards: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
  listDrops: () => Promise.resolve([]),
  listOwnedCards: () => Promise.resolve([]),
}));

vi.mock("../../lib/auth.js", () => ({
  requireUser: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: (c: { req: { header: (k: string) => string | undefined } }) =>
    c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for") ?? "127.0.0.1",
}));

const { app } = await import("../../index.js");

describe("creator page-view rate limit (M4 audit 2026-08-24)", () => {
  beforeEach(() => {
    control.inserted.length = 0;
    control.records.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function hit(headers: Record<string, string> = {}) {
    return app.request("/api/creators/karina", {
      headers: { Accept: "application/json", ...headers },
    });
  }

  it("GET pertama dari satu IP -> view tercatat", async () => {
    const res = await hit({ "cf-connecting-ip": "203.0.113.10", referer: "https://twitter.com/x" });
    expect(res.status).toBe(200);
    expect(control.records).toHaveLength(1);
  });

  it("11 view dari IP yang sama dalam window singkat -> rate-limited (429 atau 200 tanpa insert tambahan)", async () => {
    // Hit endpoint 12 kali dengan IP yang sama; minimal view ke-12 tidak menambah record.
    for (let i = 0; i < 12; i++) {
      const res = await hit({ "cf-connecting-ip": "203.0.113.20", referer: "https://t.co/x" });
      expect(res.status).toBe(200);
    }
    // Allow at most 10 recorded views per IP per window — anything beyond should be skipped silently.
    expect(control.records.length).toBeLessThanOrEqual(10);
  });

  it("IP berbeda -> counter independen", async () => {
    for (let i = 0; i < 6; i++) {
      await hit({ "cf-connecting-ip": `198.51.100.${i + 1}`, referer: "https://t.co/x" });
    }
    expect(control.records.length).toBe(6);
  });
});
