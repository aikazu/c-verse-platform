import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bid, Card, User } from "../../../lib/store.js";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  card: null as unknown,
  bids: [] as unknown[],
  users: [] as unknown[],
}));

vi.mock("../reads.js", () => ({
  getCardByNfcUid: () => Promise.resolve(null),
  getCardByNfcShortId: () => Promise.resolve(null),
  listOwnershipByCard: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/drops.js", () => ({
  getCardByIdOrNfc: () => Promise.resolve(control.card),
  getDropById: () => Promise.resolve(null),
}));
vi.mock("../../../lib/reads/users.js", () => ({
  getUserById: () => Promise.resolve(null),
  listUsersByIds: (ids: string[]) => Promise.resolve((control.users as User[]).filter((u) => ids.includes(u.id))),
}));
vi.mock("../../../lib/reads/bids.js", () => ({ listBids: () => Promise.resolve(control.bids) }));
vi.mock("../../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

// Chainable Supabase double — card detail is a pure read; persist paths never fire here.
function makeQuery() {
  const ok = { data: { id: "card-1" }, error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["update", "eq", "lt", "not", "in", "select"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(ok);
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder must be awaitable
  q.then = (resolve: (v: typeof ok) => unknown) => resolve(ok);
  return q;
}
vi.mock("../../../lib/supabase.js", () => ({ getSupabase: () => ({ from: () => makeQuery() }) }));

const { app } = await import("../../../index.js");

function makeCard(): Card {
  return {
    id: "card-1",
    dropId: "drop-1",
    unitNumber: 1,
    variant: "unsigned",
    status: "owned",
    location: "collector",
    buyoutPriceCcoin: null,
    nfcConfigured: true,
    qcStatus: "passed",
    ownerId: "owner-1",
    nfcUid: "04a1b2c3d4e580",
    nfcShortId: "drop-001",
    verifyStatus: "unknown",
    lastCtr: 0,
  } as unknown as Card;
}

function makeBid(overrides: Partial<Bid>): Bid {
  return {
    id: "bid-1",
    cardId: "card-1",
    bidderId: "bidder-1",
    bidderName: "Bidders Real Name",
    amountCCoin: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeUser(overrides: Partial<User>): User {
  return {
    id: "bidder-1",
    email: "bidder@example.com",
    displayName: "Bidders Real Name",
    username: "bidder",
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
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

interface CardDetailBody {
  activeBid: Bid | null;
  bids: Bid[];
}

function getCardDetail() {
  return app.request("/api/nfc/cards/card-1");
}

describe("GET /api/nfc/cards/:cardId — bidder name privacy masking", () => {
  beforeEach(() => {
    control.card = makeCard();
    control.bids = [];
    control.users = [];
  });

  it("masks anonymous bidder names in bids[] and activeBid", async () => {
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-anon", bidderName: "Secret Anon", amountCCoin: 200 })];
    control.users = [makeUser({ id: "bidder-anon", displayName: "Secret Anon", isAnonymous: true })];

    const res = await getCardDetail();
    const body = (await res.json()) as CardDetailBody;
    expect(body.activeBid?.bidderName).toBe("Anonim");
    expect(body.bids[0]?.bidderName).toBe("Anonim");
  });

  it("masks suspended (flagged) bidder names in bids[] and activeBid", async () => {
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-flag", bidderName: "Suspended Person", amountCCoin: 150 })];
    control.users = [makeUser({ id: "bidder-flag", displayName: "Suspended Person", flagReason: "fraud" })];

    const res = await getCardDetail();
    const body = (await res.json()) as CardDetailBody;
    expect(body.activeBid?.bidderName).toBe("Anonim");
    expect(body.bids[0]?.bidderName).toBe("Anonim");
  });

  it("keeps the real name for a normal (public, non-flagged) bidder", async () => {
    control.bids = [
      makeBid({ id: "bid-1", bidderId: "bidder-open", bidderName: "Public Bidder", amountCCoin: 300 }),
      makeBid({ id: "bid-2", bidderId: "bidder-anon", bidderName: "Secret Anon", amountCCoin: 100 }),
    ];
    control.users = [
      makeUser({ id: "bidder-open", displayName: "Public Bidder" }),
      makeUser({ id: "bidder-anon", displayName: "Secret Anon", isAnonymous: true }),
    ];

    const res = await getCardDetail();
    const body = (await res.json()) as CardDetailBody;
    expect(body.activeBid?.bidderId).toBe("bidder-open");
    expect(body.activeBid?.bidderName).toBe("Public Bidder");
    const byId = new Map(body.bids.map((b) => [b.bidderId, b.bidderName]));
    expect(byId.get("bidder-open")).toBe("Public Bidder");
    expect(byId.get("bidder-anon")).toBe("Anonim");
  });

  it("masks defensively when the bidder row is missing from users", async () => {
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-gone", bidderName: "Deleted User", amountCCoin: 120 })];
    control.users = [];

    const res = await getCardDetail();
    const body = (await res.json()) as CardDetailBody;
    expect(body.activeBid?.bidderName).toBe("Anonim");
    expect(body.bids[0]?.bidderName).toBe("Anonim");
  });
});
