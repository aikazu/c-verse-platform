import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // Raw DB rows (snake_case) — getDropById/listCardsByDrop memetakan via mapDropRow/mapCardRow.
  drop: null as null | Record<string, unknown>,
  cards: [] as Array<Record<string, unknown>>,
  // card_id values present in ownership_history for the drop's cards
  ownershipCardIds: [] as string[],
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-creator-1",
        email: "creator@x.id",
        displayName: "Creator One",
        role: "creator",
        username: null,
        usernameIsAuto: true,
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
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/supabase.js", () => {
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
      const cardQuery: Record<string, unknown> = {
        eq: () => cardQuery,
        order: () => Promise.resolve({ data: control.cards, error: null }),
      };
      return { select: () => cardQuery };
    }
    if (table === "ownership_history") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: control.ownershipCardIds.filter((cardId) => ids.includes(cardId)).map((cardId) => ({ card_id: cardId })),
              error: null,
            }),
        }),
      };
    }
    return { select: () => ({}) };
  });
  return { getSupabase: () => ({ from: fakeFrom }), readDb: () => ({ from: fakeFrom }) };
});

const { app } = await import("../../../index.js");

function getAnalytics(dropId: string) {
  return app.request(`/api/creators/me/drops/${dropId}`, {
    headers: { Authorization: "Bearer t" },
  });
}

describe("GET /api/creators/me/drops/:dropId (P0-4 batch B)", () => {
  beforeEach(() => {
    control.drop = null;
    control.cards = [];
    control.ownershipCardIds = [];
  });

  it("404 untuk drop yang tidak ada", async () => {
    control.drop = null;
    const res = await getAnalytics("drop-none");
    expect(res.status).toBe(404);
  });

  it("403 untuk drop yang bukan milik user", async () => {
    control.drop = {
      id: "drop-1",
      creator_id: "u-other",
      price_ccoin: 30,
      total_units: 100,
      sold_count: 50,
      status: "live",
    };
    const res = await getAnalytics("drop-1");
    expect(res.status).toBe(403);
  });

  it("sold hanya dari ownership_history (bukan listed/escrow/defect) + share 30% dari @c-verse/shared (audit batch 2 F2)", async () => {
    // Raw DB rows (snake_case) — getDropById/listCardsByDrop memetakan via mapDropRow/mapCardRow.
    control.drop = {
      id: "drop-1",
      creator_id: "u-creator-1",
      price_ccoin: 30,
      total_units: 8,
      sold_count: 3,
      status: "sold_out",
    };
    control.cards = [
      { id: "c-inv-1", status: "inventory", buyout_price_ccoin: null },
      { id: "c-inv-2", status: "inventory", buyout_price_ccoin: null },
      { id: "c-inv-3", status: "inventory", buyout_price_ccoin: null },
      { id: "c-bound", status: "bound", buyout_price_ccoin: null },
      { id: "c-sold", status: "sold", buyout_price_ccoin: null },
      { id: "c-listed", status: "listed_buyout", buyout_price_ccoin: 50 },
      { id: "c-escrow", status: "bid_pending", buyout_price_ccoin: null },
      { id: "c-tamper", status: "tampered", buyout_price_ccoin: null },
    ];
    // Hanya kartu yang pernah pindah tangan (primary checkout/draw atau secondary settle)
    control.ownershipCardIds = ["c-bound", "c-sold", "c-listed"];

    const res = await getAnalytics("drop-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: { total: number; sold: number; inventory: number; withBuyout: number };
      revenue: { soldCcoin: number; soldIdr: number; creatorSharePrimaryCcoin: number; creatorSharePrimaryIdr: number };
    };
    expect(body.cards.total).toBe(8);
    // listed_buyout (re-list jualan ulang) ikut terhitung via history, tapi
    // bid_pending (escrow belum settle) dan tampered (belum pernah terjual) tidak.
    expect(body.cards.sold).toBe(3);
    expect(body.cards.inventory).toBe(3);
    expect(body.cards.withBuyout).toBe(1);
    expect(body.revenue.soldCcoin).toBe(90);
    expect(body.revenue.soldIdr).toBe(90 * C_COIN_RATE_IDR);
    // 30% creator share dari REVENUE_SHARE_PLATFORM_PRODUCED — bukan hardcode
    expect(body.revenue.creatorSharePrimaryCcoin).toBe(Math.floor(90 * 0.3));
    expect(body.revenue.creatorSharePrimaryIdr).toBe(Math.floor(90 * 0.3) * C_COIN_RATE_IDR);
  });
});
