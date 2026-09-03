import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  drops: [] as Array<Record<string, unknown>>,
}));

const readsDrops = vi.hoisted(() => ({
  listDrops: vi.fn(() => Promise.resolve(control.drops)),
  listCardsByDrop: vi.fn(() => Promise.resolve([])),
  getDropById: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../../../lib/reads/drops.js", () => readsDrops);

const { app } = await import("../../../index.js");

function dropFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "drop-live",
    title: "Test Drop",
    series: "Test Series",
    narrative: "A test drop",
    artworkUrl: "/textures/test.jpg",
    totalUnits: 100,
    signedCount: 10,
    unsignedCount: 90,
    priceUnsignedCCoin: 30,
    priceSignedCCoin: 50,
    priceCcoin: 30,
    status: "live",
    dropStartAt: "2026-08-01T05:00:00.000Z",
    dropEndAt: null,
    creatorId: "creator-1",
    creatorName: "Test Creator",
    soldCount: 40,
    createdAt: "2026-08-02T00:00:00.000Z",
    isSeed: false,
    ...over,
  };
}

type DropBody = {
  drops: Array<{
    id: string;
    status: string;
    remainingUnits: number;
    idrPrice: number;
    idrUnsigned: number;
    idrSigned: number;
  }>;
  total: number;
};

describe("Drops routes", () => {
  beforeEach(() => {
    control.drops = [];
    vi.clearAllMocks();
  });

  it("GET /api/drops sorts by status priority, enriches remaining/idr, filters public statuses", async () => {
    // closed stored FIRST — route must still emit live (priority 0) before closed (priority 4)
    control.drops = [
      dropFixture({ id: "drop-closed", status: "closed", createdAt: "2026-08-03T00:00:00.000Z" }),
      dropFixture({ id: "drop-live", status: "live", createdAt: "2026-08-01T00:00:00.000Z" }),
    ];

    const res = await app.request("/api/drops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DropBody;
    expect(body.total).toBe(2);
    expect(body.drops.map((d) => d.id)).toEqual(["drop-live", "drop-closed"]);

    // enrichment derived from the fixture, not echoed: remaining = total - sold
    expect(body.drops[0].remainingUnits).toBe(60);
    expect(body.drops[0].idrPrice).toBe(30 * C_COIN_RATE_IDR);
    expect(body.drops[0].idrUnsigned).toBe(30 * C_COIN_RATE_IDR);
    expect(body.drops[0].idrSigned).toBe(50 * C_COIN_RATE_IDR);

    // db interaction: public status filter is applied at the read layer
    expect(readsDrops.listDrops).toHaveBeenCalledWith(
      expect.objectContaining({
        status: undefined,
        search: undefined,
        publicStatuses: expect.arrayContaining(["live", "published", "sold_out", "closed", "scheduled"]),
      }),
    );
  });

  it("GET /api/drops?status=live forwards the status filter to listDrops", async () => {
    const res = await app.request("/api/drops?status=live");
    expect(res.status).toBe(200);
    expect(readsDrops.listDrops).toHaveBeenCalledWith(expect.objectContaining({ status: "live" }));
  });

  it("GET /api/drops/:id returns 404 for unknown drop", async () => {
    const res = await app.request("/api/drops/tidak-ada");
    expect(res.status).toBe(404);
    expect(readsDrops.getDropById).toHaveBeenCalledWith("tidak-ada");
  });
});
