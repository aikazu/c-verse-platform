import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // Leaderboard fixtures — RPC rows returned to the route
  leaderboardRows: [] as Array<{
    rank: number;
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    total_xp: number;
    score: number;
    reached_at: string;
  }>,
  leaderboardRpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  // Creator resolution fixture for the type=creator gate
  leaderboardCreator: null as null | { id: string; role: string; flagReason: string | null },
  // Sitemap fixtures — listCreatorUsers result
  sitemapCreators: [] as Array<{
    id: string;
    displayName: string;
    username: string | null;
    role: "user" | "creator" | "admin";
    isAnonymous: boolean;
    flagReason: string | null;
    createdAt: string;
  }>,
  sitemapDrops: [] as Array<{ id: string; status: string; createdAt: string }>,
  sitemapCreatorRecs: [] as Array<{ id: string; userId: string | null; handle: string }>,
  sitemapCards: [] as Array<{ id: string; createdAt: string | null }>,
  // NFC card info fixtures
  nfcCard: null as null | {
    id: string;
    dropId: string;
    unitNumber: number;
    variant: string;
    status: string;
    location: string;
    buyoutPriceCcoin: number | null;
    nfcShortId: string;
    verifyStatus: string;
    ownerId: string | null;
  },
  nfcDrop: null as null | {
    id: string;
    title: string;
    series: string;
    artworkUrl: string;
    creatorId: string;
    creatorName: string;
  },
  nfcOwner: null as null | {
    id: string;
    displayName: string;
    username: string | null;
    isAnonymous: boolean;
    flagReason: string | null;
  },
  nfcHistory: [] as Array<{ id: string; cardId: string; ownerId: string; transferredAt: string }>,
  nfcHistoryOwners: [] as Array<{
    id: string;
    displayName: string;
    username: string | null;
    isAnonymous: boolean;
    flagReason: string | null;
  }>,
  nfcBids: [] as Array<{ id: string; cardId: string; userId: string; amountCCoin: number; status: string }>,
}));

// ─── Leaderboard: simulate the get_leaderboard RPC so we can assert args + return shape ───
function buildCardsStub() {
  return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
}

const fakeSupabaseFrom = vi.fn((table: string) => {
  if (table === "cards") return buildCardsStub();
  return { select: () => ({}) };
});

const fakeRpc = vi.fn((fn: string, args: Record<string, unknown>) => {
  control.leaderboardRpcCalls.push({ fn, args });
  return Promise.resolve({ data: control.leaderboardRows, error: null });
});

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({ from: fakeSupabaseFrom, rpc: fakeRpc }),
}));
vi.mock("../../lib/auth.js", () => ({
  requireAdmin: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));
vi.mock("../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

// Track creator-resolution lookups for the leaderboard creator gate. NFC tests
// rely on the same mock returning the owner fixture per-test via control.nfcOwner.
const fakeGetUserById = vi.fn((id: string) => {
  if (control.leaderboardCreator) {
    // For type=creator tests we let the leaderboard creator fixture win.
    if (id === control.leaderboardCreator.id) return Promise.resolve(control.leaderboardCreator);
  }
  return Promise.resolve(control.nfcOwner);
});

vi.mock("../../lib/reads/users.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/reads/users.js")>();
  return {
    ...mod,
    getUserById: (id: string) => fakeGetUserById(id),
    listUsersByIds: () => Promise.resolve(control.nfcHistoryOwners),
    getUserByUsername: () => Promise.resolve(null),
  };
});

// Mock leaderboard selector — the new RPC path. The test only verifies
// the route hands off the correct args; the selector itself is exercised
// through integration. Mock to forward rpc args for assertion.
vi.mock("../../lib/reads/gamification.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/reads/gamification.js")>();
  return {
    ...mod,
    listLeaderboard: async (type: "xp" | "cards" | "badges" | "creator", creatorId: string | null, limit: number) => {
      const { readDb } = await import("../../lib/reads.js");
      const db = readDb();
      const { data } = await db.rpc("get_leaderboard", {
        p_type: type,
        p_creator_id: creatorId,
        p_limit: limit,
      });
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        rank: Number(r.rank ?? 0),
        userId: String(r.user_id ?? ""),
        displayName: String(r.display_name ?? ""),
        username: (r.username as string | null) ?? null,
        avatarUrl: (r.avatar_url as string | null) ?? null,
        totalXp: Number(r.total_xp ?? 0),
        score: Number(r.score ?? 0),
        reachedAt: String(r.reached_at ?? ""),
      }));
    },
  };
});

// Mock sitemap-related reads
// Test fixture supplies the full set including suspended/anonymous creators so the
// production selector (which we mock) must filter them out before the route consumes
// them — mirroring the privilege boundary the real SQL filter enforces.
vi.mock("../../lib/reads/creators.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/reads/creators.js")>();
  return {
    ...mod,
    listCreatorUsers: () => Promise.resolve(control.sitemapCreators.filter((u) => !u.isAnonymous && !u.flagReason)),
    listCreators: () => Promise.resolve(control.sitemapCreatorRecs),
    getCreatorByHandle: () => Promise.resolve(null),
    getCreatorByUserId: () => Promise.resolve(null),
  };
});

vi.mock("../../lib/reads/drops.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/reads/drops.js")>();
  return {
    ...mod,
    listDrops: () =>
      Promise.resolve(
        control.sitemapDrops.map((d) => ({
          id: d.id,
          title: d.id,
          series: "",
          narrative: "",
          artworkUrl: "",
          totalUnits: 0,
          signedCount: 0,
          unsignedCount: 0,
          priceUnsignedCCoin: 0,
          priceSignedCCoin: 0,
          priceCcoin: 0,
          status: d.status as never,
          dropAt: null,
          dropStartAt: null,
          creatorId: "",
          creatorName: "",
          soldCount: 0,
          createdAt: d.createdAt,
        })),
      ),
    listCards: () => Promise.resolve(control.sitemapCards),
    // nfc route uses getCardByIdOrNfc / getDropById
    getCardByIdOrNfc: () => Promise.resolve(control.nfcCard as never),
    getDropById: () => Promise.resolve(control.nfcDrop as never),
  };
});

// Mock nfc reads
vi.mock("../../lib/reads/nfc.js", () => ({
  getCardByNfcUid: () => Promise.resolve(null),
  getCardByNfcShortId: () => Promise.resolve(null),
  listOwnershipByCard: () => Promise.resolve(control.nfcHistory),
}));
vi.mock("../../lib/reads/bids.js", () => ({
  listBids: () => Promise.resolve(control.nfcBids),
}));

const { app } = await import("../../index.js");

// ───────────────────────────────────────────────────────────────────────────────
// 1. Leaderboard — multi-type RPC contract (xp/cards/badges/creator)
// Privacy (is_anonymous + flag_reason) is enforced inside the RPC itself.
// ───────────────────────────────────────────────────────────────────────────────
const CREATOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("GET /api/gamification/leaderboard — multi-type RPC contract", () => {
  beforeEach(() => {
    control.leaderboardRows = [];
    control.leaderboardRpcCalls = [];
    control.leaderboardCreator = null;
    fakeGetUserById.mockClear();
  });

  it("defaults to type=xp with limit=20 when no query is provided", async () => {
    control.leaderboardRows = [
      {
        rank: 1,
        user_id: U1,
        display_name: "Alpha",
        username: "alpha",
        avatar_url: null,
        total_xp: 500,
        score: 500,
        reached_at: "2026-01-01T00:00:00Z",
      },
    ];
    const res = await app.request("/api/gamification/leaderboard");
    expect(res.status).toBe(200);
    // RPC was called once with the default args — global board passes null creator.
    expect(control.leaderboardRpcCalls).toHaveLength(1);
    expect(control.leaderboardRpcCalls[0]).toEqual({
      fn: "get_leaderboard",
      args: { p_type: "xp", p_creator_id: null, p_limit: 20 },
    });
    const body = (await res.json()) as {
      leaderboard: Array<{ rank: number; userId: string }>;
    };
    expect(body.leaderboard[0]?.userId).toBe(U1);
    expect(body.leaderboard[0]?.rank).toBe(1);
  });

  it("coerces limit string to int and passes it through to the RPC", async () => {
    const res = await app.request("/api/gamification/leaderboard?limit=35&type=cards");
    expect(res.status).toBe(200);
    expect(control.leaderboardRpcCalls[0]?.args).toEqual({
      p_type: "cards",
      p_creator_id: null,
      p_limit: 35,
    });
  });

  it("invalid type returns 400 from zValidator", async () => {
    const res = await app.request("/api/gamification/leaderboard?type=lol");
    expect(res.status).toBe(400);
    expect(control.leaderboardRpcCalls).toHaveLength(0);
  });

  it("type=creator without creatorId returns 400 (superRefine guard)", async () => {
    const res = await app.request("/api/gamification/leaderboard?type=creator");
    expect(res.status).toBe(400);
    expect(control.leaderboardRpcCalls).toHaveLength(0);
  });

  it("non-creator type with creatorId returns 400 (superRefine guard)", async () => {
    const res = await app.request(`/api/gamification/leaderboard?type=xp&creatorId=${CREATOR_ID}`);
    expect(res.status).toBe(400);
    expect(control.leaderboardRpcCalls).toHaveLength(0);
  });

  it("unknown creator id returns 404 before the RPC is invoked", async () => {
    control.leaderboardCreator = null;
    const res = await app.request(`/api/gamification/leaderboard?type=creator&creatorId=${CREATOR_ID}`);
    expect(res.status).toBe(404);
    expect(control.leaderboardRpcCalls).toHaveLength(0);
  });

  it("rows are mapped to entries with level/tier recomputed from total_xp (server-side, not trusted from DB)", async () => {
    // Galactic Rank Ladder (10 bands × 10 levels):
    //   total_xp=0   -> level 1,  orbit
    //   total_xp=200 -> level 21, komet
    // Formula: level = floor(total_xp/10)+1, clamp 1..100.
    control.leaderboardRows = [
      {
        rank: 1,
        user_id: U1,
        display_name: "Top",
        username: "top",
        avatar_url: null,
        total_xp: 200,
        score: 200,
        reached_at: "2026-01-01T00:00:00Z",
      },
      {
        rank: 2,
        user_id: U2,
        display_name: "Newbie",
        username: null,
        avatar_url: null,
        total_xp: 0,
        score: 0,
        reached_at: "2026-02-01T00:00:00Z",
      },
    ];
    const res = await app.request("/api/gamification/leaderboard?type=xp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      leaderboard: Array<{
        rank: number;
        userId: string;
        level: number;
        tier: string;
        totalXp: number;
        score: number;
        username: string | null;
        reachedAt: string;
      }>;
    };
    expect(body.leaderboard[0]).toMatchObject({
      rank: 1,
      userId: U1,
      level: 21,
      tier: "komet",
      totalXp: 200,
      score: 200,
      username: "top",
    });
    expect(body.leaderboard[1]).toMatchObject({
      rank: 2,
      userId: U2,
      level: 1,
      tier: "orbit",
      username: null,
    });
  });

  it("Cache-Control header differs by type: xp=60 vs cards=30", async () => {
    // xp board
    const resXp = await app.request("/api/gamification/leaderboard?type=xp");
    expect(resXp.status).toBe(200);
    expect(resXp.headers.get("Cache-Control")).toBe("public, max-age=60");

    // cards board
    const resCards = await app.request("/api/gamification/leaderboard?type=cards");
    expect(resCards.status).toBe(200);
    expect(resCards.headers.get("Cache-Control")).toBe("public, max-age=30");
  });

  it("type=creator passes the resolved creatorId to the RPC after the creator gate", async () => {
    control.leaderboardCreator = { id: CREATOR_ID, role: "creator", flagReason: null };
    const res = await app.request(`/api/gamification/leaderboard?type=creator&creatorId=${CREATOR_ID}`);
    expect(res.status).toBe(200);
    expect(control.leaderboardRpcCalls[0]).toEqual({
      fn: "get_leaderboard",
      args: { p_type: "creator", p_creator_id: CREATOR_ID, p_limit: 20 },
    });
  });

  it("privacy is enforced inside the RPC — the route does no client-side filtering", async () => {
    // The fixture represents what the RPC returns AFTER the SQL privacy filter
    // (is_anonymous=false AND flag_reason IS NULL). If the route ever filtered
    // client-side, the RPC args would not matter — but we assert the RPC was
    // called with the raw query (no from('users').eq('is_anonymous', false))
    // and the returned rows are passed through 1:1.
    control.leaderboardRows = [
      {
        rank: 1,
        user_id: U1,
        display_name: "Public",
        username: "p",
        avatar_url: null,
        total_xp: 100,
        score: 100,
        reached_at: "2026-01-01T00:00:00Z",
      },
    ];
    const res = await app.request("/api/gamification/leaderboard?type=xp");
    expect(res.status).toBe(200);
    // Only the RPC was used for rows; no from('users') chain.
    const fromCalls = fakeSupabaseFrom.mock.calls.filter((c) => c[0] === "users");
    expect(fromCalls).toHaveLength(0);
    expect(control.leaderboardRpcCalls[0]?.fn).toBe("get_leaderboard");
    const body = (await res.json()) as { leaderboard: Array<{ userId: string }> };
    expect(body.leaderboard[0]?.userId).toBe(U1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 2. Sitemap — exclude suspended (flagReason) and anonymous creators
// ───────────────────────────────────────────────────────────────────────────────
describe("GET /sitemap.xml — privacy filter on creators", () => {
  beforeEach(() => {
    control.sitemapDrops = [];
    control.sitemapCreators = [];
    control.sitemapCreatorRecs = [];
    control.sitemapCards = [];
  });

  it("sitemap excludes suspended and anonymous creators", async () => {
    control.sitemapCreators = [
      // Open creators (must appear)
      {
        id: "c-1",
        displayName: "Open Alpha",
        username: "alpha",
        role: "creator",
        isAnonymous: false,
        flagReason: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "c-2",
        displayName: "Open Beta",
        username: "beta",
        role: "creator",
        isAnonymous: false,
        flagReason: null,
        createdAt: "2026-01-02T00:00:00Z",
      },
      // Suspended — must be filtered out
      {
        id: "c-3",
        displayName: "Suspended Person",
        username: "suspended",
        role: "creator",
        isAnonymous: false,
        flagReason: "fraud",
        createdAt: "2026-01-03T00:00:00Z",
      },
      // Anonymous creator — must be filtered out
      {
        id: "c-4",
        displayName: "Anon Creator",
        username: "anon",
        role: "creator",
        isAnonymous: true,
        flagReason: null,
        createdAt: "2026-01-04T00:00:00Z",
      },
    ];
    control.sitemapCreatorRecs = [
      { id: "cr-1", userId: "c-1", handle: "alpha" },
      { id: "cr-2", userId: "c-2", handle: "beta" },
      { id: "cr-3", userId: "c-3", handle: "suspended" },
      { id: "cr-4", userId: "c-4", handle: "anon" },
    ];
    const res = await app.request("/api/seo/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/c/alpha");
    expect(xml).toContain("/c/beta");
    // Suspended + anonymous would surface as `/c/<handle>` — their ids/handles MUST NOT appear.
    expect(xml).not.toContain("/c/suspended");
    expect(xml).not.toContain("/c/anon");
  });

  it("sitemap with ALL creators suspended/anonymous returns no /c/ URLs", async () => {
    control.sitemapCreators = [];
    control.sitemapCreatorRecs = [];
    const res = await app.request("/api/seo/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).not.toContain("<loc>https://c-verse.co/c/");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 3. NFC card info — ownership history maps anonymous + suspended owners to "Anonim"
// ───────────────────────────────────────────────────────────────────────────────
describe("GET /api/nfc/cards/:cardId — ownership history anonymisation", () => {
  beforeEach(() => {
    control.nfcCard = {
      id: "card-1",
      dropId: "drop-1",
      unitNumber: 7,
      variant: "unsigned",
      status: "owned",
      location: "collector",
      buyoutPriceCcoin: null,
      nfcShortId: "drop-001",
      verifyStatus: "verified",
      ownerId: "u-current",
    };
    control.nfcDrop = {
      id: "drop-1",
      title: "Test Drop",
      series: "S1",
      artworkUrl: "/a.jpg",
      creatorId: "creator-1",
      creatorName: "Creator One",
    };
    control.nfcOwner = {
      id: "u-current",
      displayName: "Current Owner",
      username: "current",
      isAnonymous: false,
      flagReason: null,
    };
    control.nfcHistory = [
      { id: "oh-1", cardId: "card-1", ownerId: "u-public", transferredAt: "2026-01-01T00:00:00Z" },
      { id: "oh-2", cardId: "card-1", ownerId: "u-anon", transferredAt: "2026-02-01T00:00:00Z" },
      { id: "oh-3", cardId: "card-1", ownerId: "u-suspended", transferredAt: "2026-03-01T00:00:00Z" },
    ];
    control.nfcHistoryOwners = [
      { id: "u-public", displayName: "Public Owner", username: "public", isAnonymous: false, flagReason: null },
      { id: "u-anon", displayName: "Real Name Of Anon", username: "anon", isAnonymous: true, flagReason: null },
      { id: "u-suspended", displayName: "Suspended Real", username: "bad", isAnonymous: false, flagReason: "fraud_confirmed" },
    ];
    control.nfcBids = [];
  });

  it("maps anonymous historical owner → 'Anonim'", async () => {
    const res = await app.request("/api/nfc/cards/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ownershipHistory: Array<{ ownerId: string; ownerName: string }>;
    };
    const anonRow = body.ownershipHistory.find((h) => h.ownerId === "u-anon");
    expect(anonRow?.ownerName).toBe("Anonim");
  });

  it("maps suspended historical owner → 'Anonim'", async () => {
    const res = await app.request("/api/nfc/cards/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ownershipHistory: Array<{ ownerId: string; ownerName: string }>;
    };
    const susRow = body.ownershipHistory.find((h) => h.ownerId === "u-suspended");
    expect(susRow?.ownerName).toBe("Anonim");
  });

  it("preserves real displayName for public historical owner", async () => {
    const res = await app.request("/api/nfc/cards/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ownershipHistory: Array<{ ownerId: string; ownerName: string }>;
    };
    const pubRow = body.ownershipHistory.find((h) => h.ownerId === "u-public");
    expect(pubRow?.ownerName).toBe("Public Owner");
  });
});
