import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// ?stats=1 serves PRIVATE analytics (totalViews/uniqueViewers/topReferrer) — must be
// fenced exactly like GET /:username/views/stats: anon 401, other user 403, owner 200,
// active admin 200 regardless of assurance level.
const control = vi.hoisted(() => ({
  viewer: null as null | { id: string; role: string; aal: string; flagReason?: string | null },
  pageViews: [] as Array<{ userId: string | null; referrer: string | null }>,
}));

function authUser(v: NonNullable<typeof control.viewer>) {
  return {
    id: v.id,
    email: `${v.id}@x.id`,
    displayName: "Viewer",
    role: v.role,
    username: null,
    usernameIsAuto: true,
    totalXp: 0,
    level: 1,
    cumulativeSpendCcoin: 0,
    isAnonymous: false,
    flagReason: v.flagReason ?? null,
    consentAnalyticsDetail: false,
    consentDataMarket: false,
    createdAt: new Date().toISOString(),
  };
}

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    const v = control.viewer;
    if (!v) return Promise.resolve({ error: 401 });
    if (v.flagReason) return Promise.resolve({ error: 403, reason: "suspended" });
    return Promise.resolve({ user: authUser(v), token: "t", aal: v.aal });
  },
  requireAdmin: () => {
    const v = control.viewer;
    if (!v) return Promise.resolve({ error: 401 });
    if (v.flagReason) return Promise.resolve({ error: 403, reason: "suspended" });
    if (v.role !== "admin") return Promise.resolve({ error: 403, reason: "not_admin" });
    return Promise.resolve({ user: authUser(v), token: "t" });
  },
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

const readsCreators = vi.hoisted(() => ({
  listCreators: vi.fn(() => Promise.resolve([])),
  getCreatorByHandle: vi.fn(() => Promise.resolve(null)),
  getCreatorByUserId: vi.fn(() =>
    Promise.resolve({ id: "cr-1", userId: "u-owner", handle: "karina-official", totalFollowersCombined: null }),
  ),
  listCreatorUsers: vi.fn(() => Promise.resolve([])),
  listCreatorPageViews: vi.fn(() => Promise.resolve(control.pageViews)),
  recordCreatorPageView: vi.fn(),
}));

const readsDrops = vi.hoisted(() => ({
  listDrops: vi.fn(() => Promise.resolve([])),
}));

const readsUsers = vi.hoisted(() => ({
  getUserById: vi.fn(() => Promise.resolve(null)),
  getUserByUsername: vi.fn(() => Promise.resolve(null)),
  listUsersByIds: vi.fn(() => Promise.resolve([])),
}));

const readsProfiles = vi.hoisted(() => ({
  getUserByUsernameOrId: vi.fn((raw: string) =>
    Promise.resolve(
      raw === "u-owner"
        ? {
            id: "u-owner",
            email: "owner@x.id",
            displayName: "Owner",
            role: "creator",
            username: "owner",
            usernameIsAuto: false,
            flagReason: null,
          }
        : null,
    ),
  ),
  getUserRank: vi.fn(() => Promise.resolve(1)),
  listUserBadges: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/creators.js", () => readsCreators);
vi.mock("../../../lib/reads/drops.js", () => readsDrops);
vi.mock("../../../lib/reads/users.js", () => readsUsers);
vi.mock("../../../lib/reads/profiles.js", () => readsProfiles);

const { app } = await import("../../../index.js");

function getStats() {
  return app.request("/api/creators/u-owner?stats=1", {
    headers: control.viewer ? { Authorization: "Bearer t" } : {},
  });
}

describe("GET /api/creators/:id?stats=1 — private analytics fence (audit batch 2 F1)", () => {
  beforeEach(() => {
    control.viewer = null;
    control.pageViews = [
      { userId: "u-viewer-1", referrer: "https://instagram.com/p/1" },
      { userId: "u-viewer-1", referrer: "https://twitter.com/2" },
      { userId: null, referrer: null },
    ];
    vi.clearAllMocks();
  });

  it("anon → 401", async () => {
    control.viewer = null;
    const res = await getStats();
    expect(res.status).toBe(401);
  });

  it("user lain → 403", async () => {
    control.viewer = { id: "u-other", role: "user", aal: "aal1" };
    const res = await getStats();
    expect(res.status).toBe(403);
  });

  it("owner → 200 dengan stats", async () => {
    control.viewer = { id: "u-owner", role: "creator", aal: "aal1" };
    const res = await getStats();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stats: { totalViews: number; uniqueViewers: number } };
    expect(body.stats.totalViews).toBe(3);
    expect(body.stats.uniqueViewers).toBe(1);
  });

  it("admin aal2 → 200", async () => {
    control.viewer = { id: "u-admin", role: "admin", aal: "aal2" };
    const res = await getStats();
    expect(res.status).toBe(200);
  });

  it("admin aal1 → 200", async () => {
    control.viewer = { id: "u-admin", role: "admin", aal: "aal1" };
    const res = await getStats();
    expect(res.status).toBe(200);
  });

  it("tanpa stats=1 tetap publik (anon 200, tanpa stats di body)", async () => {
    const res = await app.request("/api/creators/u-owner");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stats?: unknown };
    expect(body.stats).toBeUndefined();
  });
});
