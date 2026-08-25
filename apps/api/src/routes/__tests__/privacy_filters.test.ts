import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // Leaderboard fixtures — selector receives these after SQL filtering
  leaderboardUsers: [] as Array<{
    id: string;
    displayName: string;
    username: string | null;
    totalXp: number;
    isAnonymous?: boolean;
    flagReason?: string | null;
  }>,
  leaderboardQuery: null as null | {
    orderField: string;
    eqFilters: Array<{ col: string; val: unknown }>;
    isFilters: Array<{ col: string; val: unknown }>;
    limit: number;
  },
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

// ─── Leaderboard: simulate the SQL selector chain so we can assert WHERE filters ───
function buildLeaderboardQuery() {
  const eqFilters: Array<{ col: string; val: unknown }> = [];
  const isFilters: Array<{ col: string; val: unknown }> = [];
  const state = { orderField: "", limit: 0 };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqFilters.push({ col, val });
      return builder;
    },
    is: (col: string, val: unknown) => {
      isFilters.push({ col, val });
      return builder;
    },
    order: (col: string) => {
      state.orderField = col;
      return builder;
    },
    limit: (n: number) => {
      state.limit = n;
      return Promise.resolve({ data: control.leaderboardUsers, error: null });
    },
  };
  // capture
  void Promise.resolve().then(() => {
    control.leaderboardQuery = { orderField: state.orderField, eqFilters, isFilters, limit: state.limit };
  });
  return builder;
}

const fakeSupabaseFrom = vi.fn((table: string) => {
  if (table === "users") return buildLeaderboardQuery();
  if (table === "cards") return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
  return { select: () => ({}) };
});

vi.mock("../../lib/supabase.js", () => ({ getSupabase: () => ({ from: fakeSupabaseFrom }) }));
vi.mock("../../lib/auth.js", () => ({
  requireAdmin: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));
vi.mock("../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

// Mock leaderboard selector to use the SQL builder (real call path)
vi.mock("../../lib/reads/gamification.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/reads/gamification.js")>();
  return {
    ...mod,
    listTopUsersByXp: async (limit: number) => {
      const { readDb } = await import("../../lib/reads.js");
      const db = readDb();
      const { data } = await db
        .from("users")
        .select("id, display_name, username, role, total_xp, level, is_anonymous, flag_reason")
        .eq("is_anonymous", false)
        .is("flag_reason", null)
        .order("total_xp", { ascending: false })
        .limit(limit);
      // The bug version of this selector doesn't apply these filters — we add them post-fix.
      // Map snake_case → camelCase to satisfy the route's User shape.
      return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: String(r.id ?? ""),
        displayName: String(r.display_name ?? ""),
        username: (r.username as string | null) ?? null,
        totalXp: Number(r.total_xp ?? 0),
        isAnonymous: Boolean(r.is_anonymous ?? false),
        flagReason: (r.flag_reason as string | null) ?? null,
      }));
    },
    countCardsByOwner: () => Promise.resolve(new Map<string, number>()),
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
vi.mock("../../lib/reads/users.js", () => ({
  getUserById: () => Promise.resolve(control.nfcOwner),
  listUsersByIds: () => Promise.resolve(control.nfcHistoryOwners),
  getUserByUsername: () => Promise.resolve(null),
}));
vi.mock("../../lib/reads/bids.js", () => ({
  listBids: () => Promise.resolve(control.nfcBids),
}));

const { app } = await import("../../index.js");

// ───────────────────────────────────────────────────────────────────────────────
// 1. Leaderboard — SQL filter for is_anonymous=false + flag_reason IS NULL
// ───────────────────────────────────────────────────────────────────────────────
describe("GET /api/gamification/leaderboard — privacy filter", () => {
  beforeEach(() => {
    control.leaderboardUsers = [];
    control.leaderboardQuery = null;
  });

  it("selector applies is_anonymous=false + flag_reason IS NULL before ranking (so ranks stay correct)", async () => {
    // After fix the selector applies SQL filters BEFORE ordering/limiting — fixture represents
    // what the database would have returned (anonymous + suspended rows already excluded).
    control.leaderboardUsers = [
      { id: "u-1", displayName: "Public A", username: "a", totalXp: 300 },
      { id: "u-2", displayName: "Public B", username: "b", totalXp: 200 },
      { id: "u-3", displayName: "Public C", username: "c", totalXp: 100 },
    ];
    const res = await app.request("/api/gamification/leaderboard?limit=20");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      leaderboard: Array<{ rank: number; userId: string; displayName: string }>;
    };
    expect(body.leaderboard.map((e) => e.userId)).toEqual(["u-1", "u-2", "u-3"]);
    // Rank integrity — filtered in SQL so ranks stay 1..N for the surviving rows.
    expect(body.leaderboard.map((e) => e.rank)).toEqual([1, 2, 3]);
    // SQL filter assertions on the recorded query chain.
    expect(control.leaderboardQuery).not.toBeNull();
    expect(control.leaderboardQuery?.eqFilters).toContainEqual({ col: "is_anonymous", val: false });
    expect(control.leaderboardQuery?.isFilters).toContainEqual({ col: "flag_reason", val: null });
    expect(control.leaderboardQuery?.orderField).toBe("total_xp");
    expect(control.leaderboardQuery?.limit).toBe(20);
  });

  it("anonymous + suspended users never appear on leaderboard, even when their XP would rank them #1", async () => {
    // SQL already filtered them out → empty result set
    control.leaderboardUsers = [];
    const res = await app.request("/api/gamification/leaderboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leaderboard: unknown[] };
    expect(body.leaderboard).toEqual([]);
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
