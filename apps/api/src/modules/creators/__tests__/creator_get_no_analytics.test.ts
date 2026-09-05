import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  authCalls: 0,
}));

const creator = {
  id: "u-creator",
  email: "karina@creator.id",
  displayName: "Karina",
  role: "creator",
  username: "karina",
  usernameIsAuto: false,
  totalXp: 10,
  level: 2,
  cumulativeSpendCcoin: 0,
  isAnonymous: false,
  flagReason: null,
  consentAnalyticsDetail: false,
  consentDataMarket: false,
  createdAt: "2026-09-05T00:00:00.000Z",
};

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    control.authCalls += 1;
    return Promise.resolve({ error: 401 });
  },
}));

vi.mock("../../../lib/reads/creators.js", () => ({
  getCreatorByHandle: vi.fn((handle: string) =>
    Promise.resolve(handle === "karina" ? { id: "cr-1", userId: creator.id, handle, status: "active" } : null),
  ),
  getCreatorByUserId: vi.fn(() => Promise.resolve({ id: "cr-1", userId: creator.id, handle: "karina", status: "active" })),
  listCreators: vi.fn(() => Promise.resolve([])),
  listCreatorUsers: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  listDrops: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/profiles.js", () => ({
  getUserByUsernameOrId: vi.fn((raw: string) => Promise.resolve(raw === creator.id ? creator : null)),
}));

vi.mock("../../../lib/reads/users.js", () => ({
  getUserById: vi.fn(() => Promise.resolve(creator)),
}));

const { default: app } = await import("../routes.js");

describe("creator public GET after analytics consolidation", () => {
  beforeEach(() => {
    control.authCalls = 0;
    vi.clearAllMocks();
  });

  it.each(["/karina", "/u-creator", "/handle/karina"])("GET %s does not write a page view or require a session", async (path) => {
    const response = await app.request(path, { headers: { referer: "https://example.test/post" } });

    expect(response.status).toBe(200);
    expect(control.authCalls).toBe(0);
  });

  it.each(["?stats=1", "?includeStats=1"])("keeps legacy flag %s public and omits private stats", async (query) => {
    const response = await app.request(`/karina${query}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        username: creator.username,
        handle: "karina",
        totalFollowersCombined: null,
        xp: creator.totalXp,
      },
      drops: [],
    });
    expect(control.authCalls).toBe(0);
  });
});
