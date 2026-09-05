import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { user: { id: "private-owner", isAnonymous: true } } as object,
  admin: { error: 403 } as object,
  listBadges: vi.fn(),
  progress: vi.fn(),
  awards: vi.fn(),
}));
vi.mock("../../../lib/auth.js", () => ({
  requireUser: async () => state.user,
  requireAdmin: async () => state.admin,
  adminGateError: () => ({ body: { error: "Forbidden" }, status: 403 }),
  clientIp: vi.fn(),
  tokenFingerprint: vi.fn(),
}));
vi.mock("../reads.js", () => ({
  listBadges: state.listBadges,
  getBadgeProgress: state.progress,
  listUserBadges: state.awards,
  listLeaderboard: vi.fn(),
}));
vi.mock("../../../lib/reads/kyc.js", () => ({ logAuditDb: vi.fn() }));
vi.mock("../../../lib/reads/users.js", () => ({ getUserById: vi.fn() }));
vi.mock("../../../lib/reads.js", () => ({ readDb: vi.fn() }));
const { default: app } = await import("../routes.js");

describe("badge catalog and private progress boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { user: { id: "private-owner", isAnonymous: true } };
    state.admin = { error: 403 };
    state.listBadges.mockResolvedValue([]);
    state.progress.mockResolvedValue({ collect_count: 7 });
    state.awards.mockResolvedValue([{ userId: "private-owner", badgeId: "b1", xpRewardSnapshot: 100 }]);
  });

  it("lets an anonymous-profile owner read only their own progress, without shared caching", async () => {
    const response = await app.request("/badges/me/progress?userId=someone-else");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.progress).toHaveBeenCalledWith("private-owner");
    expect(state.awards).toHaveBeenCalledWith("private-owner");
    expect(await response.json()).toEqual({ progress: { collect_count: 7 }, badges: [{ badgeId: "b1", xpRewardSnapshot: 100 }] });
  });

  it.each([401, 403])("denies progress when auth returns %s", async (status) => {
    state.user = { error: status };
    const response = await app.request("/badges/me/progress");
    expect(response.status).toBe(status);
    expect(state.progress).not.toHaveBeenCalled();
  });

  it("keeps inactive catalogue access behind the admin gate", async () => {
    expect((await app.request("/badges/admin/catalog")).status).toBe(403);
    expect(state.listBadges).not.toHaveBeenCalled();
    state.admin = { user: { id: "admin" } };
    const response = await app.request("/badges/admin/catalog");
    expect(response.status).toBe(200);
    expect(state.listBadges).toHaveBeenCalledWith(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("public catalog uses active definitions and a short cache", async () => {
    const response = await app.request("/badges");
    expect(response.status).toBe(200);
    expect(state.listBadges).toHaveBeenCalledWith();
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
