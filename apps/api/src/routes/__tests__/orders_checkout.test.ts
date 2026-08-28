import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcData: { id: "order-1", dropId: "drop-1", status: "settled", deliveryOption: "vault" } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
}));

vi.mock("../../lib/auth.js", () => ({
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

// Keep the REAL rpc wrapper (db.js) so the test proves the wrapper sends the
// single-param contract { p_drop_id }; only userDb() is swapped for a capture.
vi.mock("../../lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/db.js")>();
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

const { app } = await import("../../index.js");

function checkout(body: Record<string, unknown>) {
  return app.request("/api/orders/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("checkout — vault settlement contract (single-param RPC)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcData = { id: "order-1", dropId: "drop-1", status: "settled", deliveryOption: "vault" };
    control.rpcError = null;
  });

  it("body { dropId } saja -> RPC checkout dipanggil dengan pool default 'regular'", async () => {
    const res = await checkout({ dropId: "drop-1" });
    expect(res.status).toBe(201);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("checkout");
    expect(control.rpcCalls[0]?.args).toEqual({ p_drop_id: "drop-1", p_pool: "regular" });
    const body = (await res.json()) as { order: Record<string, unknown>; dbPath: string };
    expect(body.order.status).toBe("settled");
    expect(body.dbPath).toBe("rpc");
  });

  it("pool eksplisit 'premium' diteruskan ke RPC", async () => {
    const res = await checkout({ dropId: "drop-1", pool: "premium" });
    expect(res.status).toBe(201);
    expect(control.rpcCalls[0]?.args).toEqual({ p_drop_id: "drop-1", p_pool: "premium" });
  });

  it("shipping fields tidak lagi diterima di titik beli (body vault-only)", async () => {
    // Address/fee dikirim tetap sukses secara HTTP (field di-strip), tapi RPC
    // TIDAK menerima param shipping lagi — kontrak settle-vault terjaga.
    const res = await checkout({ dropId: "drop-1", deliveryOption: "shipping", shippingAddress: "Jl. Test 123", shippingFeeCcoin: 9 });
    expect(res.status).toBe(201);
    expect(control.rpcCalls[0]?.args).toEqual({ p_drop_id: "drop-1", p_pool: "regular" });
  });

  it("pool di luar enum ditolak 400 sebelum RPC", async () => {
    const res = await checkout({ dropId: "drop-1", pool: "gold" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("confirm-delivered endpoint sudah dihapus (404)", async () => {
    const res = await app.request("/api/orders/order-1/confirm-delivered", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("RpcError INSUFFICIENT -> 402", async () => {
    control.rpcError = { message: "INSUFFICIENT" };
    const res = await checkout({ dropId: "drop-1" });
    expect(res.status).toBe(402);
  });
});
