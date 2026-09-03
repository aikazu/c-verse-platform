import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// Lane P2: hidden branch (is_anonymous) tidak boleh membocorkan displayName
// asli maupun UUID — harus "Anonim" via publicDisplayName dan tanpa `id`.
const control = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
}));

vi.mock("../../../lib/reads/profiles.js", () => ({
  getUserByUsernameOrId: (raw: string) =>
    Promise.resolve(control.user ? { ...control.user, username: control.user.username ?? raw } : null),
  getUserRank: () => Promise.resolve(1),
  listUserBadges: () => Promise.resolve([]),
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  listDrops: () => Promise.resolve([]),
  listCards: () => Promise.resolve([]),
}));

const { app } = await import("../../../index.js");

const ANON_USER = {
  id: "anon-uuid-1234",
  email: "anon@cverse.id",
  displayName: "Rahasia Banget",
  username: "rahasia",
  role: "user" as const,
  avatarUrl: null,
  totalXp: 42,
  level: 5,
  cumulativeSpendCcoin: 0,
  isAnonymous: true,
  flagReason: null,
  consentAnalyticsDetail: false,
  consentDataMarket: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("GET /api/public/u/:username — hidden profile (lane P2 anon leak)", () => {
  beforeEach(() => {
    control.user = null;
  });

  it("user anonim → displayName 'Anonim' dan payload TANPA id (UUID tidak bocor)", async () => {
    control.user = ANON_USER;
    const res = await app.request("/api/public/u/rahasia");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown>; hidden: boolean };
    expect(body.hidden).toBe(true);
    expect(body.user.displayName).toBe("Anonim");
    expect(body.user.isAnonymous).toBe(true);
    expect("id" in body.user).toBe(false);
  });

  it("user publik → payload tetap membawa id + displayName asli (regression guard)", async () => {
    control.user = { ...ANON_USER, id: "pub-uuid-5678", displayName: "Budi Publik", isAnonymous: false };
    const res = await app.request("/api/public/u/budi");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown>; hidden?: boolean };
    expect(body.hidden).toBeUndefined();
    expect(body.user.id).toBe("pub-uuid-5678");
    expect(body.user.displayName).toBe("Budi Publik");
  });
});
