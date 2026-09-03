import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bid, Card, User } from "../../../lib/store.js";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  card: null as unknown,
  shortIdCard: null as unknown,
  bids: [] as unknown[],
  users: [] as unknown[],
  viewer: null as unknown,
  history: [] as unknown[],
}));

vi.mock("../../../lib/auth.js", () => ({
  getOptionalUser: () => Promise.resolve(control.viewer),
  requireUser: () => Promise.resolve({ error: 401 }),
  requireAdmin: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));
vi.mock("../reads.js", () => ({
  getCardByNfcUid: () => Promise.resolve(control.card),
  getCardByNfcShortId: () => Promise.resolve(control.shortIdCard ?? null),
  listOwnershipByCard: () => Promise.resolve(control.history),
}));
vi.mock("../../../lib/reads/drops.js", () => ({
  getCardByIdOrNfc: () => Promise.resolve(control.card),
  getDropById: () => Promise.resolve(null),
}));
vi.mock("../../../lib/reads/users.js", () => ({
  getUserById: (id: string) => Promise.resolve((control.users as User[]).find((u) => u.id === id) ?? null),
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
    control.shortIdCard = null;
    control.bids = [];
    control.users = [];
    control.viewer = null;
    control.history = [];
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
    expect(body.activeBid?.bidderName).toBe("Public Bidder");
    const byName = new Map(body.bids.map((b) => [b.bidderName, b.amountCCoin]));
    expect(byName.get("Public Bidder")).toBe(300);
    expect(byName.get("Anonim")).toBe(100);
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

// Owner directive 2026-09-01 (BID_CANCEL_COOLDOWN): viewer butuh tahu kapan
// cancel bidnya menjadi mungkin — activeBid miliknya (isMine) membawa
// canCancelAt = createdAt + BID_CANCEL_COOLDOWN_HOURS. canCancelAt tidak
// diberikan untuk bid orang lain (bids[] list di payload ini maupun list
// publik /api/bids/card/:cardId) — kontrak UI-nya cancel control milik
// bidder sendiri, bukan privacy timing (createdAt memang publik di Bid).
describe("GET /api/nfc/cards/:cardId — bid cancel cooldown (canCancelAt)", () => {
  beforeEach(() => {
    control.card = makeCard();
    control.shortIdCard = null;
    control.bids = [];
    control.users = [];
    control.viewer = null;
    control.history = [];
  });

  it("own activeBid (isMine) includes ISO canCancelAt = createdAt + 24h", async () => {
    // Deterministik dari fixture createdAt "2026-08-01T00:00:00Z".
    control.users = [makeUser({ id: "bidder-1" })];
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-1", amountCCoin: 90 })];
    control.viewer = control.users[0];

    const res = await getCardDetail();
    const body = (await res.json()) as { activeBid: { isMine?: boolean; canCancelAt?: string; createdAt: string } | null };
    expect(body.activeBid?.isMine).toBe(true);
    // toISOString() menormalkan ke presisi milidetik — bandingkan instant-nya.
    expect(body.activeBid?.canCancelAt).toBe(new Date(new Date("2026-08-01T00:00:00Z").getTime() + 86_400_000).toISOString());
    expect(Number.isNaN(new Date(body.activeBid?.canCancelAt ?? "").getTime())).toBe(false);
  });

  it("activeBid milik viewer lain (isMine false) has NO canCancelAt; bids[] never carries it", async () => {
    control.users = [makeUser({ id: "bidder-1" })];
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-1", amountCCoin: 90 })];
    control.viewer = makeUser({ id: "someone-else" });

    const res = await getCardDetail();
    const body = (await res.json()) as {
      activeBid: Record<string, unknown> | null;
      bids: Array<Record<string, unknown>>;
    };
    expect(body.activeBid?.isMine).toBe(false);
    expect(body.activeBid && "canCancelAt" in body.activeBid).toBe(false);
    expect(body.bids.every((b) => !("canCancelAt" in b))).toBe(true);
  });

  it("anonymous viewer: activeBid milik orang lain tanpa canCancelAt", async () => {
    control.users = [makeUser({ id: "bidder-1" })];
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-1", amountCCoin: 90 })];

    const res = await getCardDetail();
    const body = (await res.json()) as { activeBid: Record<string, unknown> | null };
    expect(body.activeBid?.isMine).toBeUndefined();
    expect(body.activeBid && "canCancelAt" in body.activeBid).toBe(false);
  });
});

// Lane C (remediation batch 1): identitas owner/bidder tidak boleh bocor di
// payload publik — UUID stabil (owner.id, bidderId) memungkinkan deanonymisasi
// lintas-listing meskipun nama sudah dimasking "Anonim".
describe("GET /api/nfc/cards/:cardId — public payload identity stripping (lane C)", () => {
  beforeEach(() => {
    control.card = makeCard();
    control.shortIdCard = null;
    control.bids = [];
    control.users = [];
    control.viewer = null;
  });

  it("strips technical/identity keys: card.ownerId, card.nfcUid, card.lastCtr, owner.id, bids[].bidderId, ownershipHistory[].ownerId", async () => {
    control.users = [makeUser({ id: "owner-1", displayName: "Open Owner" })];
    control.bids = [makeBid({ id: "bid-1", bidderId: "owner-1", bidderName: "Open Owner", amountCCoin: 90 })];
    control.history = [
      {
        id: "hist-1",
        cardId: "card-1",
        ownerId: "owner-1",
        acquiredVia: "primary",
        orderId: null,
        bidId: null,
        transferredAt: "2026-08-01T00:00:00Z",
      },
    ];

    const res = await getCardDetail();
    const body = (await res.json()) as {
      card: Record<string, unknown>;
      owner: Record<string, unknown> | null;
      activeBid: Record<string, unknown> | null;
      bids: Array<Record<string, unknown>>;
      ownershipHistory: Array<Record<string, unknown>>;
    };
    expect(body.card.nfcUid).toBeUndefined();
    expect(body.card.lastCtr).toBeUndefined();
    expect(body.card.ownerId).toBeUndefined();
    expect(body.owner && "id" in body.owner).toBe(false);
    expect(body.activeBid && "bidderId" in body.activeBid).toBe(false);
    expect(body.bids.length).toBeGreaterThan(0);
    expect(body.bids.every((b) => !("bidderId" in b))).toBe(true);
    // ownership rows ada (riwayat tetap tampil, ownerName terisi) tapi tanpa ownerId
    expect(body.ownershipHistory.length).toBeGreaterThan(0);
    expect(body.ownershipHistory[0].ownerName).toBe("Open Owner");
    expect(body.ownershipHistory.every((h) => !("ownerId" in h))).toBe(true);
  });

  it("anonymous owner → owner 'Anonim' tanpa username; owner publik → nama + username, tanpa id", async () => {
    control.users = [makeUser({ id: "owner-1", displayName: "Secret Owner", username: "secret-owner", isAnonymous: true })];
    const anonRes = await getCardDetail();
    const anonBody = (await anonRes.json()) as { owner: { displayName: string; username: string | null } | null };
    expect(anonBody.owner?.displayName).toBe("Anonim");
    expect(anonBody.owner?.username ?? null).toBeNull();

    control.users = [makeUser({ id: "owner-1", displayName: "Open Owner", username: "open-owner" })];
    const openRes = await getCardDetail();
    const openBody = (await openRes.json()) as { owner: { displayName: string; username: string | null } | null };
    expect(openBody.owner?.displayName).toBe("Open Owner");
    expect(openBody.owner?.username).toBe("open-owner");
  });

  it("personalisasi viewer: isOwner untuk pemilik, isMine untuk bid-nya sendiri — tanpa membocorkan id", async () => {
    control.users = [
      makeUser({ id: "owner-1", displayName: "Open Owner", username: "open-owner" }),
      makeUser({ id: "bidder-1", displayName: "Bidders Real Name" }),
    ];
    control.bids = [makeBid({ id: "bid-1", bidderId: "bidder-1", bidderName: "Bidders Real Name", amountCCoin: 90 })];

    // viewer anonim: isOwner/isMine false
    const anonRes = await getCardDetail();
    const anonBody = (await anonRes.json()) as { owner: { isOwner?: boolean } | null; activeBid: { isMine?: boolean } | null };
    expect(anonBody.owner?.isOwner).toBe(false);
    expect(anonBody.activeBid?.isMine ?? false).toBe(false);

    // viewer = pemilik kartu
    control.viewer = control.users[0];
    const ownerRes = await getCardDetail();
    const ownerBody = (await ownerRes.json()) as { owner: { isOwner?: boolean } | null };
    expect(ownerBody.owner?.isOwner).toBe(true);

    // viewer = bidder aktif
    control.viewer = control.users[1];
    const bidderRes = await getCardDetail();
    const bidderBody = (await bidderRes.json()) as { activeBid: { isMine?: boolean } | null };
    expect(bidderBody.activeBid?.isMine).toBe(true);
  });

  it("GET /cards/:cardId/3d — owner anonim → owner null; owner publik → { name, link } tanpa id", async () => {
    control.users = [makeUser({ id: "owner-1", displayName: "Secret Owner", username: "secret-owner", isAnonymous: true })];
    const anonRes = await app.request("/api/nfc/cards/card-1/3d");
    const anonBody = (await anonRes.json()) as { owner: { id?: string; name: string; link: string | null } | null };
    expect(anonBody.owner).toBeNull();

    control.users = [makeUser({ id: "owner-1", displayName: "Open Owner", username: "open-owner" })];
    const openRes = await app.request("/api/nfc/cards/card-1/3d");
    const openBody = (await openRes.json()) as { owner: { id?: string; name: string; link: string } | null };
    expect(openBody.owner?.name).toBe("Open Owner");
    expect(openBody.owner?.link).toBe("/u/open-owner");
    expect(openBody.owner && "id" in openBody.owner).toBe(false);
  });

  it("GET /verify/:shortId — owner anonim → displayName 'Anonim'", async () => {
    control.shortIdCard = makeCard();
    control.users = [makeUser({ id: "owner-1", displayName: "Secret Owner", isAnonymous: true })];
    const res = await app.request("/api/nfc/verify/drop-001");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner: { displayName: string } | null };
    expect(body.owner?.displayName).toBe("Anonim");
  });

  it("POST /verify-nfc — owner anonim → displayName 'Anonim' (branch CMAC)", async () => {
    control.users = [makeUser({ id: "owner-1", displayName: "Secret Owner", isAnonymous: true })];
    // field crypto ada → route masuk branch verifyTap yang mengembalikan owner
    // (master key tidak diset di file ini → verifyStatus unknown, owner tetap diekspos → harus ter-mask).
    const res = await app.request("/api/nfc/verify-nfc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "04a1b2c3d4e580", counter: "000005", cmac: "0011223344556677" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner: { displayName: string } | null };
    expect(body.owner?.displayName).toBe("Anonim");
  });
});
