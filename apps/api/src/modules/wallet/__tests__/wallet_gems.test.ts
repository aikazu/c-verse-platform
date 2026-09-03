import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// C-Gems ledger (dual-token docs/07): riwayat gem_transactions dikirim bareng
// GET /api/wallet sebagai `gemTxs` — mengikuti pola `transactions` (C-Coin).
// Transport (lib/reads.js readDb) di-swap query-builder stub; selector asli
// wallet/reads.js diuji tanpa mock (pola leaderboard_privacy.test.ts).
const control = vi.hoisted(() => ({
  viewer: null as null | { id: string },
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    const v = control.viewer;
    if (!v) return Promise.resolve({ error: 401 });
    return Promise.resolve({
      user: {
        id: v.id,
        email: "test@cverse.id",
        displayName: "Test",
        role: "user",
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
      token: "mock-token",
    });
  },
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads.js", () => ({
  readDb: () => {
    const build = (table: string): Record<string, unknown> => {
      const b: Record<string, unknown> = {};
      const track =
        (method: string) =>
        (...args: unknown[]) => {
          control.calls.push({ table, method, args });
          return b;
        };
      b.select = track("select");
      b.eq = track("eq");
      b.order = track("order");
      b.limit = track("limit");
      b.maybeSingle = () => Promise.resolve({ data: control.rows[table]?.[0] ?? null, error: null });
      // biome-ignore lint/suspicious/noThenProperty: stub builder harus thenable supaya bisa di-await seperti klien Supabase
      b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: control.rows[table] ?? [], error: null }).then(resolve, reject);
      return b;
    };
    return { from: (table: string) => build(table) };
  },
  mapWalletRow: (r: Record<string, unknown>) => ({
    userId: r.user_id,
    balanceCCoin: Number(r.balance_ccoin ?? 0),
    balanceGems: Number(r.balance_gems ?? 0),
    totalTopupCCoin: 0,
    totalSpentCCoin: 0,
    holdPayoutUntil: null,
  }),
  mapWalletTxRow: (r: Record<string, unknown>) => r,
}));

const { app } = await import("../../../index.js");
const { listGemTxs } = await import("../reads.js");

const TS_NEW = "2026-09-02T10:00:00.000Z";
const TS_OLD = "2026-09-01T10:00:00.000Z";
// Urutan desc seperti hasil DB (created_at desc) — kredit royalty terbaru dulu.
const GEM_ROWS = [
  { amount: 45, balance_after_gems: 45, ref_type: "royalty", created_at: TS_NEW },
  { amount: -10, balance_after_gems: 35, ref_type: "convert", created_at: TS_OLD },
];

function primeWalletRows() {
  control.rows.wallets = [{ user_id: "user-1", balance_ccoin: 100, balance_gems: 45 }];
  control.rows.gem_lots = [];
  control.rows.wallet_transactions = [];
}

describe("listGemTxs — read selector gem_transactions", () => {
  beforeEach(() => {
    control.calls = [];
    control.rows = { gem_transactions: GEM_ROWS };
  });

  it("memetakan snake_case ke camelCase dengan shape {amount, balanceAfterGems, refType, createdAt}", async () => {
    const rows = await listGemTxs("user-1");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ amount: 45, balanceAfterGems: 45, refType: "royalty", createdAt: TS_NEW });
    expect(rows[1]).toEqual({ amount: -10, balanceAfterGems: 35, refType: "convert", createdAt: TS_OLD });
    // Shape dipin: tidak ada kolom lain (idem_key/ref_table/ref_id) yang bocor.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["amount", "balanceAfterGems", "createdAt", "refType"]);
  });

  it("hanya milik user (eq user_id), urut created_at desc, limit default 100", async () => {
    await listGemTxs("user-1");
    const gem = control.calls.filter((c) => c.table === "gem_transactions");
    expect(gem.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "user-1")).toBe(true);
    expect(
      gem.some((c) => c.method === "order" && c.args[0] === "created_at" && (c.args[1] as { ascending?: boolean }).ascending === false),
    ).toBe(true);
    expect(gem.some((c) => c.method === "limit" && c.args[0] === 100)).toBe(true);
  });

  it("limit custom diteruskan ke query", async () => {
    await listGemTxs("user-1", 5);
    const gem = control.calls.filter((c) => c.table === "gem_transactions");
    expect(gem.some((c) => c.method === "limit" && c.args[0] === 5)).toBe(true);
  });
});

describe("GET /api/wallet — field gemTxs di response yang sama", () => {
  beforeEach(() => {
    control.calls = [];
    control.rows = { gem_transactions: GEM_ROWS };
    primeWalletRows();
    control.viewer = { id: "user-1" };
  });

  it("mengirim gemTxs camelCase milik caller (limit 100, sama seperti transactions)", async () => {
    const res = await app.request("/api/wallet", {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gemTxs?: Array<Record<string, unknown>> };
    expect(body.gemTxs).toHaveLength(2);
    expect(body.gemTxs?.[0]).toMatchObject({ amount: 45, balanceAfterGems: 45, refType: "royalty" });
    const gem = control.calls.filter((c) => c.table === "gem_transactions");
    expect(gem.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "user-1")).toBe(true);
    expect(gem.some((c) => c.method === "limit" && c.args[0] === 100)).toBe(true);
  });

  it("tanpa auth -> 401", async () => {
    control.viewer = null;
    const res = await app.request("/api/wallet");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Unauthorized");
  });
});
