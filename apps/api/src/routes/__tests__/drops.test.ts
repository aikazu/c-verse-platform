import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

vi.mock("../../lib/reads/drops.js", () => ({
  listDrops: () =>
    Promise.resolve([
      {
        id: "drop-test-1",
        title: "Test Drop",
        series: "Test Series",
        narrative: "A test drop for E2E",
        artworkUrl: "/textures/test.jpg",
        totalUnits: 100,
        signedCount: 10,
        unsignedCount: 90,
        priceUnsignedCCoin: 30,
        priceSignedCCoin: 50,
        priceCcoin: 30,
        status: "live",
        dropAt: new Date().toISOString(),
        dropStartAt: new Date().toISOString(),
        creatorId: "creator-1",
        creatorName: "Test Creator",
        soldCount: 10,
        createdAt: new Date().toISOString(),
      },
    ]),
  listCardsByDrop: () => Promise.resolve([]),
  getDropById: () => Promise.resolve(null),
}));

const { app } = await import("../../index.js");

describe("Drops routes", () => {
  it("GET /api/drops returns drops list", async () => {
    const res = await app.request("/api/drops");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drops: unknown[] };
    expect(body.drops).toBeDefined();
    expect(Array.isArray(body.drops)).toBe(true);
    expect(body.drops.length).toBeGreaterThan(0);
  });

  it("GET /api/drops/:id returns 404 for unknown drop", async () => {
    const res = await app.request("/api/drops/tidak-ada");
    expect(res.status).toBe(404);
  });
});
