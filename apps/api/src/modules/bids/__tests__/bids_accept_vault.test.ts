import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcData: { id: "bid-1", cardId: "card-9", status: "accepted" } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@cverse.id",
        displayName: "User",
        role: "user",
        username: null,
        usernameIsAuto: true,
      },
      token: "t",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

// Real RPC wrappers + RpcError; swap only the transport (userDb).
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

vi.mock("../../../lib/reads/bids.js", () => ({
  listBids: () => Promise.resolve([]),
}));

const { app } = await import("../../../index.js");

function accept(body: Record<string, unknown>) {
  return app.request("/api/bids/cards/card-9/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("accept-bid — vault-only settlement (founder 2026-08-28)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcData = { id: "bid-1", cardId: "card-9", status: "accepted" };
    control.rpcError = null;
  });

  it("body kosong -> settle ke vault: RPC accept_bid tanpa address user", async () => {
    const res = await accept({});
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("accept_bid");
    expect(control.rpcCalls[0]?.args).toEqual({ p_card_id: "card-9", p_destination: "platform_vault", p_address: null });
    const body = (await res.json()) as { ok: boolean; bid: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.bid.status).toBe("accepted");
  });

  it("body legacy (destination/shippingAddress/shippingFeeCcoin) ditolak 400 (strict) — tidak sampai RPC", async () => {
    const res = await accept({ destination: "buyer_address", shippingAddress: "Jl. Test 123, Jakarta", shippingFeeCcoin: 5 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("error mapping existing tetap: RpcError FORBIDDEN -> 403", async () => {
    control.rpcError = { message: "FORBIDDEN" };
    const res = await accept({});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("error mapping existing tetap: RpcError CARD_NOT_TRADABLE -> 403", async () => {
    control.rpcError = { message: "CARD_NOT_TRADABLE" };
    const res = await accept({});
    expect(res.status).toBe(403);
  });
});
