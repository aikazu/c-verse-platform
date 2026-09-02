import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rpcData: null as unknown,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  // Event log urutan operasi — convert wajib re-read wallet SETELAH RPC sukses.
  events: [] as string[],
  wallet: {
    userId: "user-1",
    balanceCCoin: 0,
    balanceGems: 950,
    totalTopupCCoin: 1000,
    totalSpentCCoin: 1000,
    holdPayoutUntil: null,
    gemsMatured: 950,
    gemsLocked: 0,
  } as Record<string, unknown>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "user-1",
        email: "test@cverse.id",
        displayName: "Test",
        role: "user",
        username: null,
        usernameIsAuto: true,
      },
      token: "mock-token",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

const reads = vi.hoisted(() => ({
  getWallet: vi.fn((userId: string) => {
    control.events.push("getWallet");
    return Promise.resolve({ ...control.wallet, userId });
  }),
  listWalletTxs: vi.fn(() => Promise.resolve([])),
  isPayoutHeld: vi.fn(() => Promise.resolve({ held: false, until: null })),
}));

vi.mock("../reads.js", () => reads);

// Real RpcError mapping; only the transport (userDb) is swapped for a capture
// stub — route tests mock lib/db.js, never lib/supabase.js.
vi.mock("../../../lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/db.js")>();
  return {
    ...actual,
    userDb: () => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        control.events.push(`rpc:${fn}`);
        control.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: control.rpcData, error: control.rpcError });
      },
    }),
  };
});

const { app } = await import("../../../index.js");

function convert(body: Record<string, unknown>) {
  return app.request("/api/wallet/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mock-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wallet/convert — Gems -> C-Coin 1:1 via RPC convert_gems", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.events = [];
    control.rpcData = null;
    control.rpcError = null;
  });

  it("happy path: RPC convert_gems dipanggil dengan { p_amount } lalu wallet terbaru dikembalikan", async () => {
    const res = await convert({ amountGems: 50 });
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("convert_gems");
    expect(control.rpcCalls[0]?.args).toEqual({ p_amount: 50 });
    // Wallet read terbaru (post-RPC) adalah sumber respons — bukan saldo sebelum konversi.
    expect(control.events).toEqual(["rpc:convert_gems", "getWallet"]);
    expect(reads.getWallet).toHaveBeenCalledWith("user-1");
    const body = (await res.json()) as { wallet: Record<string, unknown> };
    expect(body.wallet.balanceGems).toBe(950);
    expect(body.wallet.gemsMatured).toBe(950);
    expect(body.wallet.gemsLocked).toBe(0);
  });

  it("RpcError INSUFFICIENT_GEMS -> 400 dengan pesan ramah (bukan raw DB error)", async () => {
    control.rpcError = { message: "INSUFFICIENT_GEMS" };
    const res = await convert({ amountGems: 999999 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("INSUFFICIENT_GEMS");
    expect(body.error).toContain("Gems tidak cukup");
  });

  it("RpcError AUTH_REQUIRED -> 401", async () => {
    control.rpcError = { message: "AUTH_REQUIRED" };
    const res = await convert({ amountGems: 10 });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  it("zod tetap: amountGems 0 ditolak 400 sebelum RPC", async () => {
    const res = await convert({ amountGems: 0 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountGems negatif ditolak 400 sebelum RPC", async () => {
    const res = await convert({ amountGems: -5 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountGems non-integer (1.5) ditolak 400 sebelum RPC", async () => {
    const res = await convert({ amountGems: 1.5 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountGems string ditolak 400 sebelum RPC", async () => {
    const res = await convert({ amountGems: "50" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountGems tidak ada ditolak 400 sebelum RPC", async () => {
    const res = await convert({});
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });
});
