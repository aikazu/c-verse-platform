import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  cardById: null as Record<string, unknown> | null,
  detailDrop: null as Record<string, unknown> | null,
  users: [] as Array<Record<string, unknown>>,
  bidsByCard: [] as Array<Record<string, unknown>>,
}));

const readsDrops = vi.hoisted(() => ({
  getCardByIdOrNfc: vi.fn(() => Promise.resolve(control.cardById)),
  getDropById: vi.fn(() => Promise.resolve(control.detailDrop)),
}));

const readsUsers = vi.hoisted(() => ({
  listUsersByIds: vi.fn((ids: string[]) => Promise.resolve(control.users.filter((u) => ids.includes(String(u.id))))),
}));

const readsBids = vi.hoisted(() => ({
  listBidsByCard: vi.fn(() => Promise.resolve(control.bidsByCard)),
}));

vi.mock("../../../lib/reads/drops.js", () => readsDrops);
vi.mock("../../../lib/reads/users.js", () => readsUsers);
vi.mock("../../../lib/reads/bids.js", () => readsBids);

const { app } = await import("../../../index.js");

function cardFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "card-a",
    dropId: "drop-1",
    unitNumber: 1,
    variant: "unsigned",
    status: "owned",
    location: "user_vault",
    buyoutPriceCcoin: 45,
    nfcConfigured: true,
    qcStatus: "passed",
    ownerId: "owner-1",
    nfcUid: "04A1AABBCC01",
    nfcShortId: "a-001",
    verifyStatus: "verified",
    lastCtr: 5,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function dropFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "drop-1",
    title: "Genesis Box",
    series: "Genesis",
    narrative: "First drop",
    artworkUrl: "/textures/genesis.jpg",
    totalUnits: 100,
    signedCount: 10,
    unsignedCount: 90,
    priceUnsignedCCoin: 30,
    priceSignedCCoin: 50,
    priceCcoin: 30,
    status: "live",
    dropAt: "2026-08-01T05:00:00.000Z",
    dropStartAt: "2026-08-01T05:00:00.000Z",
    dropEndAt: null,
    creatorId: "creator-1",
    creatorName: "Nova Cree",
    soldCount: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    isSeed: false,
    ...over,
  };
}

function userFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "owner-1",
    email: "owner1@cverse.id",
    displayName: "Owner One",
    username: "owner1",
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

type BrowseDetailBody = {
  card: { id: string };
  drop: { id: string } | null;
  owner: { id: string; displayName: string } | null;
  activeBid: { id: string; bidderName: string } | null;
  bids: Array<{ id: string; bidderName: string; amountCCoin: number }>;
};

// Flat GET /api/browse dihapus (konsumen tunggal Browse.tsx pindah ke
// GET /api/drops) — browse module kini hanya menyajikan detail per kartu.
describe("GET /api/browse/cards/:id — detail + A3 masking", () => {
  beforeEach(() => {
    control.cardById = null;
    control.detailDrop = null;
    control.users = [];
    control.bidsByCard = [];
    vi.clearAllMocks();
  });

  it("returns 404 for unknown card", async () => {
    const res = await app.request("/api/browse/cards/nope");
    expect(res.status).toBe(404);
    expect(readsDrops.getCardByIdOrNfc).toHaveBeenCalledWith("nope");
  });

  it("returns detail: bids desc capped at 20, activeBid, owner mapping", async () => {
    control.cardById = cardFixture();
    control.detailDrop = dropFixture();
    control.users = [userFixture()];
    control.bidsByCard = Array.from({ length: 22 }, (_, i) => {
      const amount = i + 1;
      return {
        id: `bid-${amount}`,
        cardId: "card-a",
        bidderId: `u-${amount}`,
        bidderName: `Bidder ${amount}`,
        amountCCoin: amount,
        status: amount === 22 ? "active" : "outbid",
      };
    });

    const res = await app.request("/api/browse/cards/card-a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseDetailBody;
    expect(body.card.id).toBe("card-a");
    expect(body.drop?.id).toBe("drop-1");
    expect(body.owner).toEqual({ id: "owner-1", displayName: "Owner One" });
    // sorted desc by amount, hard cap 20 entries
    expect(body.bids).toHaveLength(20);
    expect(body.bids[0].amountCCoin).toBe(22);
    expect(body.bids[19].amountCCoin).toBe(3);
    expect(body.activeBid?.id).toBe("bid-22");

    expect(readsDrops.getCardByIdOrNfc).toHaveBeenCalledWith("card-a");
    expect(readsDrops.getDropById).toHaveBeenCalledWith("drop-1");
    expect(readsBids.listBidsByCard).toHaveBeenCalledWith("card-a");
    expect(readsUsers.listUsersByIds).toHaveBeenCalledWith(["owner-1"]);
  });

  it("owner anonim → displayName 'Anonim'", async () => {
    control.cardById = cardFixture({ ownerId: "anon-1" });
    control.detailDrop = dropFixture();
    control.users = [userFixture({ id: "anon-1", isAnonymous: true })];

    const res = await app.request("/api/browse/cards/card-a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseDetailBody;
    expect(body.owner).toEqual({ id: "anon-1", displayName: "Anonim" });
  });

  it("owner flagged (suspended) → displayName 'Anonim'", async () => {
    control.cardById = cardFixture({ ownerId: "flag-1" });
    control.detailDrop = dropFixture();
    control.users = [userFixture({ id: "flag-1", flagReason: "suspended" })];

    const res = await app.request("/api/browse/cards/card-a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseDetailBody;
    expect(body.owner).toEqual({ id: "flag-1", displayName: "Anonim" });
  });

  it("bidder anonim → bids[].bidderName dan activeBid.bidderName 'Anonim'", async () => {
    control.cardById = cardFixture();
    control.detailDrop = dropFixture();
    control.bidsByCard = [
      { id: "bid-2", cardId: "card-a", bidderId: "anon-b", bidderName: "Hidden Bidder", amountCCoin: 90, status: "active" },
      { id: "bid-1", cardId: "card-a", bidderId: "ok-1", bidderName: "Visible Bidder", amountCCoin: 40, status: "outbid" },
    ];
    control.users = [
      userFixture({ id: "anon-b", isAnonymous: true }),
      userFixture({ id: "ok-1", displayName: "Visible Bidder", username: "visible1" }),
    ];

    const res = await app.request("/api/browse/cards/card-a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseDetailBody;
    expect(body.activeBid?.bidderName).toBe("Anonim");
    expect(body.bids.find((b) => b.id === "bid-2")?.bidderName).toBe("Anonim");
    expect(body.bids.find((b) => b.id === "bid-1")?.bidderName).toBe("Visible Bidder");
  });
});
