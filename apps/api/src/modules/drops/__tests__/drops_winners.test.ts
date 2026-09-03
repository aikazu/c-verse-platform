import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  drop: null as Record<string, unknown> | null,
  cards: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/auth.js", () => ({
  getOptionalUser: () => Promise.resolve(null),
  requireUser: () => Promise.resolve({ error: 401 }),
  requireAdmin: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
  _resetSupabaseCache: () => undefined,
}));

const readsDrops = vi.hoisted(() => ({
  getDropById: vi.fn(() => Promise.resolve(control.drop)),
  listCardsByDrop: vi.fn(() => Promise.resolve(control.cards)),
  listDrops: vi.fn(() => Promise.resolve([])),
}));

const readsUsers = vi.hoisted(() => ({
  getUserById: vi.fn(() => Promise.resolve(null)),
  listUsersByIds: vi.fn((ids: string[]) => Promise.resolve(control.users.filter((u) => ids.includes(String(u.id))))),
}));

const readsCreators = vi.hoisted(() => ({
  getCreatorByUserId: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../../../lib/reads/drops.js", () => readsDrops);
vi.mock("../../../lib/reads/users.js", () => readsUsers);
vi.mock("../../../lib/reads/creators.js", () => readsCreators);

const { app } = await import("../../../index.js");

function dropFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "drop-x",
    title: "Aespa Signed",
    series: "Aespa",
    narrative: "Winter signed drop",
    status: "sold_out",
    totalUnits: 10,
    soldCount: 10,
    drawnAt: null,
    priceCcoin: 30,
    priceUnsignedCCoin: 30,
    priceSignedCCoin: 50,
    creatorId: "creator-1",
    creatorName: "Creator",
    isSeed: false,
    ...over,
  };
}

function cardFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "card-01",
    dropId: "drop-x",
    unitNumber: 1,
    variant: "signed",
    status: "bound",
    location: "user_vault",
    buyoutPriceCcoin: null,
    ownerId: "winner-1",
    nfcConfigured: true,
    qcStatus: "passed",
    nfcUid: "04A1AABBCC01",
    nfcShortId: "x-001",
    verifyStatus: "verified",
    lastCtr: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function userFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "winner-1",
    email: "winner1@cverse.id",
    displayName: "Winner One",
    username: "winner1",
    role: "user",
    avatarUrl: null,
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

type WinnersBody = { winners?: Array<{ unitNumber: number; variant: string; displayName: string }> };
type DropCardsBody = { cards: Array<{ id: string; unitNumber: number; variant: string; status: string; isOwned: boolean }> };

describe("GET /api/drops/:id — winners (B1)", () => {
  beforeEach(() => {
    control.drop = null;
    control.cards = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("sold_out → winners hadir: signed dulu lalu unitNumber asc, kartu tanpa owner dikecualikan", async () => {
    control.drop = dropFixture();
    control.cards = [
      cardFixture({ id: "card-03", unitNumber: 3, variant: "unsigned", ownerId: "winner-3", nfcShortId: "x-003" }),
      cardFixture({ id: "card-09", unitNumber: 9, variant: "unsigned", ownerId: null, status: "inventory", location: "platform_stock" }),
      cardFixture({ id: "card-02", unitNumber: 2, ownerId: "winner-2", nfcShortId: "x-002" }),
      cardFixture({ id: "card-01", unitNumber: 1 }),
    ];
    control.users = [
      userFixture(),
      userFixture({ id: "winner-2", displayName: "Winner Two", username: "winner2" }),
      userFixture({ id: "winner-3", displayName: "Winner Three", username: "winner3" }),
    ];

    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as WinnersBody;
    expect(body.winners).toEqual([
      { unitNumber: 1, variant: "signed", displayName: "Winner One" },
      { unitNumber: 2, variant: "signed", displayName: "Winner Two" },
      { unitNumber: 3, variant: "unsigned", displayName: "Winner Three" },
    ]);
    expect(readsUsers.listUsersByIds).toHaveBeenCalledTimes(1);
  });

  it("owner anonim / flagged → displayName 'Anonim'", async () => {
    control.drop = dropFixture({ status: "closed", drawnAt: "2026-08-02T12:00:00.000Z" });
    control.cards = [
      cardFixture({ id: "card-01", unitNumber: 1, ownerId: "anon-1" }),
      cardFixture({ id: "card-02", unitNumber: 2, ownerId: "flag-1", nfcShortId: "x-002" }),
      cardFixture({ id: "card-03", unitNumber: 3, variant: "unsigned", ownerId: "ok-1", nfcShortId: "x-003" }),
    ];
    control.users = [
      userFixture({ id: "anon-1", isAnonymous: true }),
      userFixture({ id: "flag-1", displayName: "Flagged One", username: "flag1", flagReason: "suspended" }),
      userFixture({ id: "ok-1", displayName: "Ok One", username: "ok1" }),
    ];

    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as WinnersBody;
    expect(body.winners).toEqual([
      { unitNumber: 1, variant: "signed", displayName: "Anonim" },
      { unitNumber: 2, variant: "signed", displayName: "Anonim" },
      { unitNumber: 3, variant: "unsigned", displayName: "Ok One" },
    ]);
  });

  it("drop live → winners TIDAK ada di response", async () => {
    control.drop = dropFixture({ status: "live", soldCount: 2 });
    control.cards = [
      cardFixture(),
      cardFixture({ id: "card-02", unitNumber: 2, variant: "unsigned", ownerId: "winner-2", nfcShortId: "x-002" }),
    ];
    control.users = [userFixture()];

    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as WinnersBody;
    expect("winners" in body).toBe(false);
    expect(readsUsers.listUsersByIds).not.toHaveBeenCalled();
  });

  it("drop published (belum sold_out, belum drawn) → winners TIDAK ada", async () => {
    control.drop = dropFixture({ status: "published" });
    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as WinnersBody;
    expect("winners" in body).toBe(false);
  });
});

describe("GET /api/drops/:id/cards — per-drop card list (B1)", () => {
  beforeEach(() => {
    control.drop = null;
    control.cards = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("semua kartu drop, signed dulu lalu unitNumber asc, tanpa identitas owner", async () => {
    control.drop = dropFixture();
    control.cards = [
      cardFixture({ id: "card-03", unitNumber: 3, variant: "unsigned", ownerId: "winner-3", nfcShortId: "x-003" }),
      cardFixture({ id: "card-09", unitNumber: 9, variant: "unsigned", ownerId: null, status: "inventory", location: "platform_stock" }),
      cardFixture({ id: "card-02", unitNumber: 2, ownerId: "winner-2", nfcShortId: "x-002" }),
      cardFixture({ id: "card-01", unitNumber: 1 }),
    ];

    const res = await app.request("/api/drops/drop-x/cards");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DropCardsBody;
    expect(body.cards).toEqual([
      { id: "card-01", unitNumber: 1, variant: "signed", status: "bound", isOwned: true },
      { id: "card-02", unitNumber: 2, variant: "signed", status: "bound", isOwned: true },
      { id: "card-03", unitNumber: 3, variant: "unsigned", status: "bound", isOwned: true },
      { id: "card-09", unitNumber: 9, variant: "unsigned", status: "inventory", isOwned: false },
    ]);
    // no owner identity lookup — the per-drop grid carries isOwned only
    expect(readsUsers.listUsersByIds).not.toHaveBeenCalled();
  });

  it("drop tidak ditemukan → 404", async () => {
    const res = await app.request("/api/drops/drop-404/cards");
    expect(res.status).toBe(404);
  });

  it("drop non-publik (draft) → 404", async () => {
    control.drop = dropFixture({ status: "draft" });
    const res = await app.request("/api/drops/drop-x/cards");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/drops/:id — status gate & cardsPreview projection (lane C)", () => {
  beforeEach(() => {
    control.drop = null;
    control.cards = [];
    control.users = [];
    vi.clearAllMocks();
  });

  it("drop draft → 404 (id time-based mudah ditebak — gate paritas dengan /:id/cards)", async () => {
    control.drop = dropFixture({ status: "draft" });
    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(404);
  });

  it("drop cancelled → 404", async () => {
    control.drop = dropFixture({ status: "cancelled" });
    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(404);
  });

  it("cardsPreview diproyeksi minimal { id, unitNumber, variant } — tanpa nfcUid/lastCtr/ownerId", async () => {
    control.drop = dropFixture();
    control.cards = [
      cardFixture({ id: "card-01", unitNumber: 1, ownerId: "winner-1" }),
      cardFixture({ id: "card-02", unitNumber: 2, variant: "unsigned", ownerId: "winner-2", nfcShortId: "x-002" }),
    ];
    control.users = [userFixture()];

    const res = await app.request("/api/drops/drop-x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cardsPreview?: Array<Record<string, unknown>> };
    expect(body.cardsPreview).toHaveLength(2);
    for (const preview of body.cardsPreview ?? []) {
      expect(Object.keys(preview).sort()).toEqual(["id", "unitNumber", "variant"]);
      expect(preview.nfcUid).toBeUndefined();
      expect(preview.lastCtr).toBeUndefined();
      expect(preview.ownerId).toBeUndefined();
    }
  });
});
