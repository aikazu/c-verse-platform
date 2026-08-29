import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  ownedCards: [] as Array<Record<string, unknown>>,
  drops: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
  activeBids: [] as Array<Record<string, unknown>>,
  cardById: null as Record<string, unknown> | null,
  detailDrop: null as Record<string, unknown> | null,
  bidsByCard: [] as Array<Record<string, unknown>>,
}));

const readsDrops = vi.hoisted(() => ({
  listOwnedCards: vi.fn(() => Promise.resolve(control.ownedCards)),
  listDrops: vi.fn(() => Promise.resolve(control.drops)),
  getDropById: vi.fn(() => Promise.resolve(control.detailDrop)),
  getCardByIdOrNfc: vi.fn(() => Promise.resolve(control.cardById)),
  listCardsByDrop: vi.fn(() => Promise.resolve([])),
  listCardsByIds: vi.fn(() => Promise.resolve([])),
  listCards: vi.fn(() => Promise.resolve([])),
}));

const readsUsers = vi.hoisted(() => ({
  listUsersByIds: vi.fn((ids: string[]) => Promise.resolve(control.users.filter((u) => ids.includes(String(u.id))))),
  getUserById: vi.fn(() => Promise.resolve(null)),
  getUserByUsername: vi.fn(() => Promise.resolve(null)),
}));

const readsBids = vi.hoisted(() => ({
  listBids: vi.fn(() => Promise.resolve(control.activeBids)),
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

const ownerOne = {
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
};

type BrowseCard = {
  card: { id: string; nfcShortId: string; buyoutPriceCcoin: number | null };
  drop: { title: string } | null;
  owner: { id: string; displayName: string } | null;
  buyoutIdr: number | null;
  activeBid: { id: string } | null;
  canBid: boolean;
};

type BrowseBody = { cards: BrowseCard[]; results: BrowseCard[]; total: number };

describe("GET /api/browse (PG-BROWSE-01)", () => {
  beforeEach(() => {
    control.ownedCards = [];
    control.drops = [];
    control.users = [];
    control.activeBids = [];
    control.cardById = null;
    control.detailDrop = null;
    control.bidsByCard = [];
    vi.clearAllMocks();
  });

  it("lists owned cards enriched with drop/owner/activeBid and camelCase shape", async () => {
    control.ownedCards = [
      cardFixture({ id: "card-b", nfcShortId: "b-002", ownerId: "owner-2", dropId: "drop-404", buyoutPriceCcoin: null }),
      cardFixture(),
    ];
    control.drops = [dropFixture()];
    control.users = [ownerOne];
    control.activeBids = [
      { id: "bid-0", cardId: "card-a", bidderId: "u-9", bidderName: "Bidder", amountCCoin: 50, status: "active" },
      { id: "bid-1", cardId: "card-a", bidderId: "u-8", bidderName: "Bidder 2", amountCCoin: 70, status: "active" },
    ];

    const res = await app.request("/api/browse");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseBody;

    // default sort: nfcShortId asc
    expect(body.cards.map((c) => c.card.nfcShortId)).toEqual(["a-001", "b-002"]);
    expect(body.total).toBe(2);
    expect(body.results).toEqual(body.cards);

    // camelCase passthrough + derived buyoutIdr from shared rate
    expect(body.cards[0].card.id).toBe("card-a");
    expect(body.cards[0].drop?.title).toBe("Genesis Box");
    expect(body.cards[0].owner).toEqual({ id: "owner-1", displayName: "Owner One" });
    expect(body.cards[0].buyoutIdr).toBe(45 * C_COIN_RATE_IDR);
    expect(body.cards[0].canBid).toBe(true);
    // first active bid per card wins (list order)
    expect(body.cards[0].activeBid?.id).toBe("bid-0");
    // missing drop/owner degrade to null instead of throwing
    expect(body.cards[1].drop).toBeNull();
    expect(body.cards[1].owner).toBeNull();
    expect(body.cards[1].buyoutIdr).toBeNull();

    // db-facade interactions
    expect(readsDrops.listOwnedCards).toHaveBeenCalledTimes(1);
    expect(readsDrops.listDrops).toHaveBeenCalledTimes(1);
    expect(readsUsers.listUsersByIds).toHaveBeenCalledWith(expect.arrayContaining(["owner-1", "owner-2"]));
    expect(readsBids.listBids).toHaveBeenCalledWith({ status: "active" });
  });

  it("filters by q across nfcShortId/title/series/creatorName before owner lookup", async () => {
    control.ownedCards = [cardFixture({ id: "card-b", nfcShortId: "b-002", ownerId: "owner-2", dropId: "drop-2" }), cardFixture()];
    control.drops = [dropFixture(), dropFixture({ id: "drop-2", title: "Other Series", series: "Other Line" })];
    control.users = [ownerOne];

    const res = await app.request("/api/browse?q=genesis");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseBody;
    expect(body.total).toBe(1);
    expect(body.cards[0].card.id).toBe("card-a");
    // owner fetch happens on the FILTERED set only
    expect(readsUsers.listUsersByIds).toHaveBeenCalledWith(["owner-1"]);
  });

  it("filters by creator substring on creatorName or creatorId", async () => {
    control.ownedCards = [cardFixture({ id: "card-b", nfcShortId: "b-002", ownerId: "owner-2", dropId: "drop-2" }), cardFixture()];
    control.drops = [dropFixture(), dropFixture({ id: "drop-2", creatorName: "Other", creatorId: "creator-9" })];

    const res = await app.request("/api/browse?creator=nova");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseBody;
    expect(body.total).toBe(1);
    expect(body.cards[0].card.id).toBe("card-a");
  });

  it("sort=unit_number&order=desc orders by unitNumber desc", async () => {
    control.ownedCards = [cardFixture(), cardFixture({ id: "card-b", nfcShortId: "b-002", unitNumber: 7 })];
    control.drops = [dropFixture()];

    const res = await app.request("/api/browse?sort=unit_number&order=desc");
    expect(res.status).toBe(200);
    const body = (await res.json()) as BrowseBody;
    expect(body.cards.map((c) => c.card.id)).toEqual(["card-b", "card-a"]);
  });

  it("GET /cards/:id returns 404 for unknown card", async () => {
    const res = await app.request("/api/browse/cards/nope");
    expect(res.status).toBe(404);
    expect(readsDrops.getCardByIdOrNfc).toHaveBeenCalledWith("nope");
  });

  it("GET /cards/:id returns detail: bids desc capped at 20, activeBid, owner mapping", async () => {
    control.cardById = cardFixture();
    control.detailDrop = dropFixture();
    control.users = [ownerOne];
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
    const body = (await res.json()) as {
      card: { id: string };
      drop: { id: string };
      owner: { id: string; displayName: string } | null;
      activeBid: { id: string; status: string } | null;
      bids: Array<{ amountCCoin: number }>;
    };
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
});
