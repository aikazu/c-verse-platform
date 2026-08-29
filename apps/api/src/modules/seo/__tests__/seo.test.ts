import { PRIMARY_DOMAIN } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  drops: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  creatorUsers: [] as Array<Record<string, unknown>>,
  creators: [] as Array<Record<string, unknown>>,
  creatorByHandle: null as Record<string, unknown> | null,
  creatorByUserId: null as Record<string, unknown> | null,
  userById: null as Record<string, unknown> | null,
  userByUsername: null as Record<string, unknown> | null,
  cardById: null as Record<string, unknown> | null,
  dropById: null as Record<string, unknown> | null,
}));

const readsDrops = vi.hoisted(() => ({
  listDrops: vi.fn(() => Promise.resolve(control.drops)),
  getDropById: vi.fn(() => Promise.resolve(control.dropById)),
  getCardByIdOrNfc: vi.fn(() => Promise.resolve(control.cardById)),
  listOwnedCards: vi.fn(() => Promise.resolve([])),
  listCardsByDrop: vi.fn(() => Promise.resolve([])),
  listCardsByIds: vi.fn(() => Promise.resolve([])),
  listCards: vi.fn(() => Promise.resolve(control.cards)),
}));

const readsUsers = vi.hoisted(() => ({
  getUserById: vi.fn(() => Promise.resolve(control.userById)),
  getUserByUsername: vi.fn(() => Promise.resolve(control.userByUsername)),
  listUsersByIds: vi.fn(() => Promise.resolve([])),
}));

const readsCreators = vi.hoisted(() => ({
  listCreators: vi.fn(() => Promise.resolve(control.creators)),
  getCreatorByHandle: vi.fn(() => Promise.resolve(control.creatorByHandle)),
  getCreatorByUserId: vi.fn(() => Promise.resolve(control.creatorByUserId)),
  listCreatorUsers: vi.fn(() => Promise.resolve(control.creatorUsers)),
  listCreatorPageViews: vi.fn(() => Promise.resolve([])),
  recordCreatorPageView: vi.fn(),
}));

vi.mock("../../../lib/reads/drops.js", () => readsDrops);
vi.mock("../../../lib/reads/users.js", () => readsUsers);
vi.mock("../../../lib/reads/creators.js", () => readsCreators);

const { app } = await import("../../../index.js");

const base = `https://${PRIMARY_DOMAIN}`;

function dropFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "drop-live",
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

const karinaUser = {
  id: "cu-1",
  email: "karina@creator.id",
  displayName: "Karina",
  username: "karina",
  role: "creator",
  avatarUrl: null,
  xp: 0,
  totalXp: 0,
  level: 1,
  cumulativeSpendCcoin: 0,
  isAnonymous: false,
  flagReason: null,
  consentAnalyticsDetail: false,
  consentDataMarket: false,
  createdAt: "2026-08-02T00:00:00.000Z",
};

describe("GET /api/seo/sitemap.xml", () => {
  beforeEach(() => {
    control.drops = [];
    control.cards = [];
    control.creatorUsers = [];
    control.creators = [];
    vi.clearAllMocks();
  });

  it("returns xml with static pages + entries built from real reads", async () => {
    control.drops = [
      dropFixture({ id: "drop-live", status: "live" }),
      dropFixture({ id: "drop-draft", status: "draft" }),
      dropFixture({ id: "drop-cancelled", status: "cancelled" }),
    ];
    control.creatorUsers = [karinaUser];
    control.creators = [{ id: "cr-1", userId: "cu-1", handle: "karina-official", status: "active", createdAt: "2026-08-02T00:00:00.000Z" }];
    control.cards = [{ id: "card-9", createdAt: "2026-08-03T00:00:00.000Z" }];

    const res = await app.request("/api/seo/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");

    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?')).toBe(true);
    // static pages
    for (const p of ["/", "/drops", "/marketplace", "/browse", "/leaderboard"]) {
      expect(xml).toContain(`<loc>${base}${p}</loc>`);
    }
    // drop statuses outside published/live/sold_out/scheduled are excluded
    expect(xml).toContain(`<loc>${base}/drops/drop-live</loc>`);
    expect(xml).not.toContain(`/drops/drop-draft`);
    expect(xml).not.toContain(`/drops/drop-cancelled`);
    // creator slug prefers creator record handle over username
    expect(xml).toContain(`<loc>${base}/c/karina-official</loc>`);
    expect(xml).not.toContain(`<loc>${base}/c/karina</loc>`);
    expect(xml).toContain(`<loc>${base}/cards/card-9/3d</loc>`);

    expect(readsDrops.listDrops).toHaveBeenCalledTimes(1);
    expect(readsCreators.listCreatorUsers).toHaveBeenCalledTimes(1);
    expect(readsCreators.listCreators).toHaveBeenCalledTimes(1);
    expect(readsDrops.listCards).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/seo/meta", () => {
  beforeEach(() => {
    control.creatorByHandle = null;
    control.creatorByUserId = null;
    control.userById = null;
    control.userByUsername = null;
    control.cardById = null;
    control.dropById = null;
    vi.clearAllMocks();
  });

  it("creator profile: og from user, jsonLd url prefers creator handle", async () => {
    control.creatorByHandle = { id: "cr-1", userId: "cu-1", handle: "karina" };
    control.userById = karinaUser;
    control.creatorByUserId = { id: "cr-1", userId: "cu-1", handle: "karina-official" };

    const res = await app.request("/api/seo/meta?path=/c/karina");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      og: { title: string };
      jsonLd: { "@type": string; url: string; name: string } | null;
    };
    expect(body.og.title).toBe("Karina — C.Verse");
    expect(body.jsonLd?.["@type"]).toBe("Person");
    expect(body.jsonLd?.name).toBe("Karina");
    expect(body.jsonLd?.url).toBe(`${base}/c/karina-official`);
    expect(readsCreators.getCreatorByHandle).toHaveBeenCalledWith("karina");
    expect(readsUsers.getUserById).toHaveBeenCalledWith("cu-1");
  });

  it("unknown creator handle falls back to username lookup, then 404", async () => {
    const res = await app.request("/api/seo/meta?path=/c/ghost");
    expect(res.status).toBe(404);
    expect(readsCreators.getCreatorByHandle).toHaveBeenCalledWith("ghost");
    expect(readsUsers.getUserByUsername).toHaveBeenCalledWith("ghost");
  });

  it("card detail: Product jsonLd with sku + drop-derived og", async () => {
    control.cardById = { id: "card-1", dropId: "drop-1", unitNumber: 3, nfcShortId: "drp1-003" };
    control.dropById = dropFixture({ id: "drop-1", narrative: "Cerita drop" });

    const res = await app.request("/api/seo/meta?path=/cards/card-1/3d");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      og: { title: string; image: string | null };
      jsonLd: { "@type": string; name: string; sku: string } | null;
    };
    expect(body.og.title).toBe("Genesis Box #3 — C.Verse");
    expect(body.og.image).toBe("/textures/genesis.jpg");
    expect(body.jsonLd?.["@type"]).toBe("Product");
    expect(body.jsonLd?.name).toBe("Genesis Box #3");
    expect(body.jsonLd?.sku).toBe("drp1-003");
    expect(readsDrops.getCardByIdOrNfc).toHaveBeenCalledWith("card-1");
    expect(readsDrops.getDropById).toHaveBeenCalledWith("drop-1");
  });

  it("drop detail: Event jsonLd with startDate; 404 when drop missing", async () => {
    control.dropById = dropFixture({ id: "drop-1" });
    const res = await app.request("/api/seo/meta?path=/drops/drop-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jsonLd: { "@type": string; name: string; startDate?: string } | null;
    };
    expect(body.jsonLd?.["@type"]).toBe("Event");
    expect(body.jsonLd?.name).toBe("Genesis Box");
    expect(body.jsonLd?.startDate).toBe("2026-08-01T05:00:00.000Z");
    expect(readsDrops.getDropById).toHaveBeenCalledWith("drop-1");

    control.dropById = null;
    const missing = await app.request("/api/seo/meta?path=/drops/nope");
    expect(missing.status).toBe(404);
  });

  it("default path returns site-level og with null jsonLd", async () => {
    const res = await app.request("/api/seo/meta");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { og: { title: string }; jsonLd: unknown };
    expect(body.og.title).toContain("C.Verse");
    expect(body.jsonLd).toBeNull();
  });
});
