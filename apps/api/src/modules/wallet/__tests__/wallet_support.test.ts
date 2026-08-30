import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rpcData: { transactionId: "tx-support-1", balanceCcoin: 975 } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
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

vi.mock("../reads.js", () => ({
  getWallet: () => Promise.resolve({ userId: "user-1", balanceCCoin: 1000, totalTopupCCoin: 1000, totalSpentCCoin: 0 }),
  listWalletTxs: () => Promise.resolve([]),
  isPayoutHeld: () => Promise.resolve({ held: false, until: null }),
}));

// Real rpcSendSupport wrapper + real RpcError mapping; only the transport
// (userDb) is swapped for a capture stub.
vi.mock("../../../lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/db.js")>();
  return {
    ...actual,
    userDb: () => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        control.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: control.rpcData, error: control.rpcError });
      },
    }),
  };
});

const { app } = await import("../../../index.js");

const CREATOR_ID = "11111111-1111-4111-8111-111111111111";

function support(body: Record<string, unknown>) {
  return app.request("/api/wallet/support", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mock-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wallet/support — atomic RPC send_support (A1)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcData = { transactionId: "tx-support-1", balanceCcoin: 975 };
    control.rpcError = null;
  });

  it("happy path: RPC send_support dipanggil dengan { p_creator, p_amount } + response camelCase", async () => {
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 25 });
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("send_support");
    expect(control.rpcCalls[0]?.args).toEqual({ p_creator: CREATOR_ID, p_amount: 25 });
    const body = (await res.json()) as { transactionId: string; balanceCcoin: number };
    expect(body.transactionId).toBe("tx-support-1");
    expect(body.balanceCcoin).toBe(975);
  });

  it("RpcError SELF_SUPPORT -> 400 dengan pesan ramah (bukan raw DB error)", async () => {
    control.rpcError = { message: "SELF_SUPPORT" };
    const res = await support({ creatorId: "22222222-2222-4222-8222-222222222222", amountCcoin: 10 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("SELF_SUPPORT");
    expect(body.error).toContain("diri sendiri");
  });

  it("RpcError CREATOR_NOT_FOUND -> 404", async () => {
    control.rpcError = { message: "CREATOR_NOT_FOUND" };
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 10 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CREATOR_NOT_FOUND");
  });

  it("RpcError INSUFFICIENT -> 402", async () => {
    control.rpcError = { message: "INSUFFICIENT" };
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 10 });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INSUFFICIENT");
  });

  it("zod tetap: amountCcoin 0 ditolak 400 sebelum RPC", async () => {
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 0 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountCcoin negatif ditolak 400 sebelum RPC", async () => {
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: -5 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: amountCcoin non-integer (1.5) ditolak 400 sebelum RPC", async () => {
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 1.5 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod tetap: creatorId bukan uuid ditolak 400 sebelum RPC", async () => {
    const res = await support({ creatorId: "not-a-uuid", amountCcoin: 10 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("zod strict: field tak dikenal ditolak 400 sebelum RPC", async () => {
    const res = await support({ creatorId: CREATOR_ID, amountCcoin: 10, note: "hi" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });
});
