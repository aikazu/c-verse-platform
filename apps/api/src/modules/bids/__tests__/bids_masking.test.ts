import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  bids: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));

const readsBids = vi.hoisted(() => ({
  listBidsByCard: vi.fn(() => Promise.resolve(control.bids)),
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
