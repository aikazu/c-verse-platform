import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  drop: null as null | {
    id: string;
    creatorId: string;
    priceCcoin: number;
    totalUnits: number;
    soldCount: number;
    status: string;
  },
  cards: [] as Array<{
    id: string;
    status: string;
    buyoutPriceCcoin: number | null;
  }>,
}));

vi.mock("../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-creator-1",
        email: "creator@x.id",
        displayName: "Creator One",
        role: "creator",
        username: null,
        usernameIsAuto: true,
        xp: 0,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "t",
      aal: "aal1",
    }),
}));

vi.mock("../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "drops") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: control.drop, error: null }),
          }),
        }),
      };
    }
    if (table === "cards") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: control.cards, error: null }),
        }),
      };
    }
    return { select: () => ({}) };
  });
  return { getSupabase: () => ({ from: fakeFrom }), readDb: () => ({ from: fakeFrom }) };
});

const { app } = await import("../../index.js");

function getAnalytics(dropId: string) {
  return app.request(`/api/creators/me/drops/${dropId}`, {
    headers: { Authorization: "Bearer t" },
  });
}

describe("GET /api/creators/me/drops/:dropId (P0-4 batch B)", () => {
  beforeEach(() => {
    control.drop = null;
    control.cards = [];
  });

  it("404 untuk drop yang tidak ada", async () => {
    control.drop = null;
    const res = await getAnalytics("drop-none");
    expect(res.status).toBe(404);
  });

  it("403 untuk drop yang bukan milik user", async () => {
    control.drop = {
      id: "drop-1",
      creatorId: "u-other",
      priceCcoin: 30,
      totalUnits: 100,
      soldCount: 50,
      status: "live",
    };
    const res = await getAnalytics("drop-1");
    expect(res.status).toBe(403);
  });
});
