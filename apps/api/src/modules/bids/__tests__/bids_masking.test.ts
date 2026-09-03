import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  bids: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));

const readsBids = vi.hoisted(() => ({
  listBids: vi.fn(() => Promise.resolve(control.bids)),
}));

const readsUsers = vi.hoisted(() => ({
  listUsersByIds: vi.fn((ids: string[]) => Promise.resolve(control.users.filter((u) => ids.includes(String(u.id))))),
}));

vi.mock("../../../lib/reads/bids.js", () => readsBids);
vi.mock("../../../lib/reads/users.js", () => readsUsers);

const { app } = await import("../../../index.js");

function bidFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "bid-1",
    cardId: "card-1",
    bidderId: "bidder-1",
    bidderName: "Bidder One",
    amountCCoin: 50,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function userFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "bidder-1",
    email: "bidder1@cverse.id",
    displayName: "Bidder One",
    username: "bidder1",
    role: "user",
    avatarUrl: null,
    xp: 0,
    totalXp: 0,
    level: 1,
    cumulativeSpendCcoin: 0,
    isAnonymous: false,
    flagReason: null,
    consentAnalyticsDetail: false,
    consentDataMarket: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

// bidder_name is a denormalized column on bids — masking must happen at the
// read boundary (A3 privacy): anonymous or flagged bidders render as 'Anonim'.
describe("GET /api/bids — bidder masking (A3 privacy)", () => {
  beforeEach(() => {
    control.bids = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("GET /:id — bidder anonim → 'Anonim', bidder biasa → nama asli", async () => {
    control.bids = [
      bidFixture({ id: "bid-1", bidderId: "anon-1" }),
      bidFixture({ id: "bid-2", bidderId: "ok-1", bidderName: "Bidder Two" }),
    ];
    control.users = [
      userFixture({ id: "anon-1", isAnonymous: true }),
      userFixture({ id: "ok-1", displayName: "Bidder Two", username: "bidder2" }),
    ];

    const res = await app.request("/api/bids/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: Array<{ id: string; bidderName: string }> };
    expect(body.bids.find((b) => b.id === "bid-1")?.bidderName).toBe("Anonim");
    expect(body.bids.find((b) => b.id === "bid-2")?.bidderName).toBe("Bidder Two");
    expect(readsUsers.listUsersByIds).toHaveBeenCalledWith(["anon-1", "ok-1"]);
  });

  it("GET /card/:cardId — bidder flagged / tidak dikenal → 'Anonim'", async () => {
    control.bids = [bidFixture({ id: "bid-1", bidderId: "flag-1" }), bidFixture({ id: "bid-2", bidderId: "ghost-1" })];
    control.users = [userFixture({ id: "flag-1", flagReason: "suspended" })];

    const res = await app.request("/api/bids/card/card-1?days=90");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: Array<{ id: string; bidderName: string }> };
    expect(body.bids.find((b) => b.id === "bid-1")?.bidderName).toBe("Anonim");
    expect(body.bids.find((b) => b.id === "bid-2")?.bidderName).toBe("Anonim");
  });
});

// Lane C (remediation batch 1): bidderId adalah UUID stabil — walau bidderName
// sudah "Anonim", id tetap memungkinkan deanonymisasi via korelasi lintas-listing.
describe("GET /api/bids — public payload identity & window (lane C)", () => {
  const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86400000).toISOString();

  beforeEach(() => {
    control.bids = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("GET /:id — bidderId TIDAK ada di payload publik", async () => {
    control.bids = [bidFixture(), bidFixture({ id: "bid-2", bidderId: "bidder-2", bidderName: "Bidder Two" })];
    control.users = [userFixture(), userFixture({ id: "bidder-2", displayName: "Bidder Two", username: "bidder2" })];

    const res = await app.request("/api/bids/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: Array<Record<string, unknown>> };
    expect(body.bids.length).toBeGreaterThan(0);
    expect(body.bids.every((b) => !("bidderId" in b))).toBe(true);
  });

  it("GET /card/:cardId — bidderId TIDAK ada di payload publik", async () => {
    control.bids = [bidFixture({ bidderId: "anon-1" })];
    control.users = [userFixture({ id: "anon-1", isAnonymous: true })];

    const res = await app.request("/api/bids/card/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: Array<Record<string, unknown>> };
    expect(body.bids.length).toBeGreaterThan(0);
    expect(body.bids.every((b) => !("bidderId" in b))).toBe(true);
  });

  it("GET /:id — window 90 hari: bid aktif >90d tersaring, bid accepted >90d tetap tampil", async () => {
    control.bids = [
      bidFixture({ id: "bid-old-active", createdAt: daysAgoIso(100) }),
      bidFixture({ id: "bid-old-accepted", status: "accepted", createdAt: daysAgoIso(100) }),
      bidFixture({ id: "bid-fresh", bidderId: "bidder-2", bidderName: "Bidder Two", createdAt: daysAgoIso(1) }),
    ];
    control.users = [userFixture(), userFixture({ id: "bidder-2", displayName: "Bidder Two", username: "bidder2" })];

    const res = await app.request("/api/bids/card-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bids: Array<{ id: string }> };
    const ids = body.bids.map((b) => b.id);
    expect(ids).toContain("bid-old-accepted");
    expect(ids).toContain("bid-fresh");
    expect(ids).not.toContain("bid-old-active");
  });

  it("GET /card/:cardId — ?days= di-clamp 1..90 (NaN/absent → 90, >90 → 90, <=1 → 1)", async () => {
    control.bids = [
      bidFixture({ id: "bid-100d", createdAt: daysAgoIso(100) }),
      bidFixture({ id: "bid-2d", bidderId: "bidder-2", bidderName: "Bidder Two", createdAt: daysAgoIso(2) }),
    ];
    control.users = [userFixture(), userFixture({ id: "bidder-2", displayName: "Bidder Two", username: "bidder2" })];

    const getIds = async (query: string): Promise<string[]> => {
      const res = await app.request(`/api/bids/card/card-1${query}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bids: Array<{ id: string }> };
      return body.bids.map((b) => b.id);
    };

    // absent / NaN / >90 → 90 hari: bid 100d keluar, bid 2d masuk
    for (const query of ["", "?days=bogus", "?days=5000"]) {
      const ids = await getIds(query);
      expect(ids, `window for "${query || "(absent)"}"`).toContain("bid-2d");
      expect(ids, `window for "${query || "(absent)"}"`).not.toContain("bid-100d");
    }

    // <=1 → clamp ke 1 hari: bid 2d keluar
    for (const query of ["?days=0", "?days=-5", "?days=1"]) {
      const ids = await getIds(query);
      expect(ids, `window for "${query}"`).not.toContain("bid-2d");
      expect(ids, `window for "${query}"`).not.toContain("bid-100d");
    }
  });

  it("GET /:id — ?days= juga di-clamp sama seperti /card/:cardId", async () => {
    control.bids = [bidFixture({ id: "bid-2d", createdAt: daysAgoIso(2) })];
    control.users = [];

    const wide = await app.request("/api/bids/card-1?days=bogus");
    const wideBody = (await wide.json()) as { bids: Array<{ id: string }> };
    expect(wideBody.bids.map((b) => b.id)).toContain("bid-2d");

    const narrow = await app.request("/api/bids/card-1?days=0");
    const narrowBody = (await narrow.json()) as { bids: Array<{ id: string }> };
    expect(narrowBody.bids.map((b) => b.id)).not.toContain("bid-2d");
  });
});
