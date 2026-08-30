import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // null = anonim (tanpa/invalid Authorization) — endpoint tetap 200, myEntry null.
  viewer: "user-1" as string | null,
  entryRow: { pool: "premium", hold_ccoin: 40, status: "held" } as Record<string, unknown> | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  getOptionalUser: () => Promise.resolve(control.viewer ? { id: control.viewer, displayName: "Viewer", role: "user" } : null),
  requireUser: () => Promise.resolve({ error: 401 }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => {
              if (table !== "drop_entries") return Promise.resolve({ data: null, error: null });
              return Promise.resolve({ data: control.entryRow, error: null });
            },
          }),
        }),
      }),
    }),
  }),
  _resetSupabaseCache: () => undefined,
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  getDropById: () =>
    Promise.resolve({
      id: "drop-x",
      title: "Drop X",
      series: "Series",
      narrative: "n",
      status: "live",
      totalUnits: 10,
      soldCount: 2,
      priceCcoin: 30,
      priceUnsignedCCoin: 30,
      priceSignedCCoin: 50,
      creatorId: "creator-1",
      creatorName: "Creator",
    } as never),
  listCardsByDrop: () => Promise.resolve([]),
  listDrops: () => Promise.resolve([]),
}));

vi.mock("../../../lib/reads/users.js", () => ({
  getUserById: () => Promise.resolve(null),
  listUsersByIds: () => Promise.resolve([]),
}));

vi.mock("../../../lib/reads/creators.js", () => ({
  getCreatorByUserId: () => Promise.resolve(null),
}));

const { app } = await import("../../../index.js");

function getDrop(auth?: string) {
  return app.request("/api/drops/drop-x", {
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
  });
}

// Personalisasi publik: drop detail tetap anonymous-reachable, tapi pemilik sesi
// melihat status entry-nya sendiri (UI: state "sudah ikut", tanpa tombol entry ulang).
describe("GET /api/drops/:id — myEntry", () => {
  beforeEach(() => {
    control.viewer = "user-1";
    control.entryRow = { pool: "premium", hold_ccoin: 40, status: "held" };
  });

  it("pemilik sesi dengan entry → myEntry terisi (pool, holdCcoin, status)", async () => {
    const res = await getDrop("jwt-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { myEntry: { pool: string; holdCcoin: number; status: string } | null };
    expect(body.myEntry).toEqual({ pool: "premium", holdCcoin: 40, status: "held" });
  });

  it("pemilik sesi tanpa entry → myEntry null", async () => {
    control.entryRow = null;
    const res = await getDrop("jwt-1");
    const body = (await res.json()) as { myEntry: unknown };
    expect(body.myEntry).toBeNull();
  });

  it("anonim → tetap 200, myEntry null", async () => {
    control.viewer = null;
    const res = await getDrop();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { myEntry: unknown };
    expect(body.myEntry).toBeNull();
  });
});
