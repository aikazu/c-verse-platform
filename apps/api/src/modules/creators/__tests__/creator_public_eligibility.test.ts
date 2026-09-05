import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  recStatus: "active" as "active" | "inactive" | "suspended",
  userRole: "creator",
  flagReason: null as string | null,
  isAnonymous: false,
  drops: [] as Array<Record<string, unknown>>,
}));

const creator = () => ({
  id: "u-creator",
  email: "creator@example.test",
  displayName: "Creator Aktif",
  role: control.userRole,
  username: "creator-aktif",
  usernameIsAuto: false,
  totalXp: 10,
  level: 2,
  cumulativeSpendCcoin: 0,
  isAnonymous: control.isAnonymous,
  flagReason: control.flagReason,
  consentAnalyticsDetail: false,
  consentDataMarket: false,
  createdAt: "2026-09-05T00:00:00.000Z",
});

const creatorRec = () => ({
  id: "cr-1",
  userId: "u-creator",
  handle: "creator-aktif",
  totalFollowersCombined: 42,
  status: control.recStatus,
  bankAccount: null,
  notes: null,
  createdAt: "2026-09-05T00:00:00.000Z",
});

vi.mock("../../../lib/auth.js", () => ({ requireUser: () => Promise.resolve({ error: 401 }) }));
vi.mock("../../../lib/reads/creators.js", () => ({
  getCreatorByHandle: vi.fn((handle: string) => Promise.resolve(handle === "creator-aktif" ? creatorRec() : null)),
  getCreatorByUserId: vi.fn(() => Promise.resolve(creatorRec())),
  listCreators: vi.fn(() => Promise.resolve([creatorRec()])),
  listCreatorUsers: vi.fn(() => Promise.resolve([creator()])),
}));
vi.mock("../../../lib/reads/drops.js", () => ({ listDrops: vi.fn(() => Promise.resolve(control.drops)) }));
vi.mock("../../../lib/reads/profiles.js", () => ({ getUserByUsernameOrId: vi.fn(() => Promise.resolve(creator())) }));
vi.mock("../../../lib/reads/users.js", () => ({ getUserById: vi.fn(() => Promise.resolve(creator())) }));

const { default: app } = await import("../routes.js");

function drop(id: string, status: string, soldCount = 0) {
  return {
    id,
    title: id,
    series: "Series",
    narrative: "",
    artworkUrl: "",
    totalUnits: 10,
    signedCount: 1,
    unsignedCount: 9,
    priceUnsignedCCoin: 30,
    priceSignedCCoin: 50,
    priceCcoin: 30,
    status,
    dropStartAt: "2026-09-01T00:00:00.000Z",
    creatorId: "u-creator",
    creatorName: "Creator Aktif",
    soldCount,
    createdAt: "2026-09-01T00:00:00.000Z",
    isSeed: false,
  };
}

describe("creator public eligibility", () => {
  beforeEach(() => {
    control.recStatus = "active";
    control.userRole = "creator";
    control.flagReason = null;
    control.isAnonymous = false;
    control.drops = [];
  });

  it("keeps an active creator public through id and explicit handle", async () => {
    control.drops = [drop("live", "live", 3)];
    for (const path of ["/u-creator", "/handle/creator-aktif"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { creator: { id: string }; drops: Array<{ id: string }> };
      expect(body.creator.id).toBe("u-creator");
      expect(body.drops.map((item) => item.id)).toEqual(["live"]);
    }
  });

  it("hides inactive creator records and non-creator handle owners", async () => {
    control.recStatus = "inactive";
    expect((await app.request("/handle/creator-aktif")).status).toBe(404);
    expect((await app.request("/u-creator")).status).toBe(404);

    control.recStatus = "active";
    control.userRole = "collector";
    expect((await app.request("/handle/creator-aktif")).status).toBe(404);
  });

  it("never exposes drafts or cancelled drops in storefront payloads or public stats", async () => {
    control.drops = [
      drop("published", "published", 1),
      drop("live", "live", 2),
      drop("scheduled", "scheduled", 3),
      drop("sold-out", "sold_out", 4),
      drop("closed", "closed", 5),
      drop("draft", "draft", 99),
      drop("cancelled", "cancelled", 99),
    ];

    const handle = await app.request("/handle/creator-aktif");
    const handleBody = (await handle.json()) as { drops: Array<{ id: string }> };
    expect(handleBody.drops.map((item) => item.id).sort()).toEqual(["closed", "live", "published", "scheduled", "sold-out"]);

    const list = await app.request("/");
    const listBody = (await list.json()) as { creators: Array<{ stats: { drops: number; totalSold: number; totalUnits: number } }> };
    expect(listBody.creators).toHaveLength(1);
    expect(listBody.creators[0].stats).toEqual({ drops: 5, totalSold: 15, totalUnits: 50 });
  });
});
