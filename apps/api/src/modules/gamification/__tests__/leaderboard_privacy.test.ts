import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// Lane P2: userId (UUID stabil) dihapus dari payload publik leaderboard —
// pengujian lewat SELECTOR ASLI (lib/reads.js hanya transportnya yang di-mock),
// bukan lewat mock selector seperti di privacy_filters.test.ts.
const control = vi.hoisted(() => ({
  rpcRows: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("../../../lib/reads.js", () => ({
  readDb: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      control.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: control.rpcRows, error: null });
    },
  }),
  mapBadgeRow: (r: Record<string, unknown>) => r,
  mapUserBadgeRow: (r: Record<string, unknown>) => r,
}));

const { app } = await import("../../../index.js");
const { listLeaderboard } = await import("../reads.js");

const RPC_ROW = {
  rank: 1,
  user_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Alpha",
  username: null,
  avatar_url: null,
  total_xp: 120,
  score: 120,
  reached_at: "2026-01-01T00:00:00Z",
};

describe("leaderboard — userId tidak pernah keluar di payload publik (lane P2)", () => {
  beforeEach(() => {
    control.rpcRows = [];
    control.rpcCalls = [];
  });

  it("selector listLeaderboard memetakan baris RPC TANPA userId", async () => {
    control.rpcRows = [RPC_ROW];
    const rows = await listLeaderboard("xp", null, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rank: 1, displayName: "Alpha", score: 120 });
    expect(rows.every((r) => !("userId" in r))).toBe(true);
  });

  it("GET /api/gamification/leaderboard — entries xp & cards tanpa userId", async () => {
    control.rpcRows = [RPC_ROW];
    for (const type of ["xp", "cards"] as const) {
      const res = await app.request(`/api/gamification/leaderboard?type=${type}`);
      expect(res.status, `board ${type}`).toBe(200);
      const body = (await res.json()) as { leaderboard: Array<Record<string, unknown>> };
      expect(body.leaderboard.length, `board ${type}`).toBeGreaterThan(0);
      expect(
        body.leaderboard.every((e) => !("userId" in e)),
        `board ${type}`,
      ).toBe(true);
    }
  });
});
