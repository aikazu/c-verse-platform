import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  cards: [] as Array<Record<string, unknown>>,
  drops: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));

const readsDrops = vi.hoisted(() => ({
  listDrops: vi.fn(() => Promise.resolve(control.drops)),
}));

const readsUsers = vi.hoisted(() => ({
  listUsersByIds: vi.fn((ids: string[]) => Promise.resolve(control.users.filter((u) => ids.includes(String(u.id))))),
}));

const marketplaceReads = vi.hoisted(() => ({
  listMarketplaceCards: vi.fn(() => Promise.resolve(control.cards)),
}));

vi.mock("../../../lib/reads/drops.js", () => readsDrops);
vi.mock("../../../lib/reads/users.js", () => readsUsers);
vi.mock("../reads.js", () => marketplaceReads);

const { default: app } = await import("../routes.js");

function cardFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "card-a",
    dropId: "drop-1",
    unitNumber: 1,
    variant: "unsigned",
    status: "listed_buyout",
    location: "user_vault",
    buyoutPriceCcoin: 45,
    nfcConfigured: true,
    qcStatus: "passed",
    ownerId: "seller-1",
    nfcUid: "04A1AABBCC01",
    nfcShortId: "a-001",
    verifyStatus: "verified",
    lastCtr: 5,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function dropFixture(): Record<string, unknown> {
  return {
    id: "drop-1",
    title: "Genesis Box",
    series: "Genesis",
    narrative: "First drop",
    artworkUrl: "/textures/genesis.jpg",
    artwork3dUrl: null,
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
    raffleEndAt: null,
    drawnAt: null,
    creatorId: "creator-1",
    creatorName: "Nova Cree",
    soldCount: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: null,
    isSeed: false,
  };
}

function userFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "seller-1",
    email: "seller@cverse.id",
    displayName: "Seller Satu",
    username: "seller1",
    usernameIsAuto: false,
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

type Listing = { seller: { id: string; displayName: string } | null; buyoutPriceCcoin: number | null };
type Body = { marketplace: Listing[] };

describe("GET /api/marketplace seller privacy masking (A3)", () => {
  beforeEach(() => {
    control.cards = [];
    control.drops = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("masks anonymous seller displayName as 'Anonim' while keeping the id", async () => {
    control.cards = [cardFixture({ ownerId: "seller-1" })];
    control.drops = [dropFixture()];
    control.users = [userFixture({ id: "seller-1", isAnonymous: true })];

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.marketplace).toHaveLength(1);
    // id tetap dikirim (shape existing), nama diganti 'Anonim' — username tidak diekspos
    expect(body.marketplace[0].seller).toEqual({ id: "seller-1", displayName: "Anonim" });
  });

  it("keeps the real displayName for a non-anonymous seller", async () => {
    control.cards = [cardFixture({ ownerId: "seller-2" })];
    control.drops = [dropFixture()];
    control.users = [userFixture({ id: "seller-2", displayName: "Seller Dua" })];

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.marketplace[0].seller).toEqual({ id: "seller-2", displayName: "Seller Dua" });
  });

  it("masks suspended sellers too (consistent with NFC module masking)", async () => {
    control.cards = [cardFixture({ ownerId: "seller-3" })];
    control.drops = [dropFixture()];
    control.users = [userFixture({ id: "seller-3", flagReason: "fraud_review" })];

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;

    expect(body.marketplace[0].seller).toEqual({ id: "seller-3", displayName: "Anonim" });
  });
});
