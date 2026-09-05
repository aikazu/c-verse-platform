import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  authError: null as 401 | 403 | null,
  rpcData: { id: "card-1", owner_id: "buyer-1", location: "platform_vault", status: "sold" } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  userDbTokens: [] as string[],
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    if (control.authError) return Promise.resolve({ error: control.authError });
    return Promise.resolve({ user: { id: "buyer-1", email: "buyer@cverse.id", displayName: "Buyer", role: "user" }, token: "buyer-jwt" });
  },
}));

// Keep real rpcBuyoutCard/rpcSetBuyout and RpcError behavior, replacing only
// the authenticated Supabase transport for an observable route boundary.
vi.mock("../../../lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/db.js")>();
  return {
    ...actual,
    userDb: (token: string) => {
      control.userDbTokens.push(token);
      return {
        rpc: (fn: string, args: Record<string, unknown>) => {
          control.rpcCalls.push({ fn, args });
          return Promise.resolve({ data: control.rpcData, error: control.rpcError });
        },
      };
    },
  };
});

const { app } = await import("../../../index.js");

function request(path: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer buyer-jwt" },
    body: JSON.stringify(body),
  });
}

describe("marketplace vault-only buyout and price floor", () => {
  beforeEach(() => {
    control.authError = null;
    control.rpcData = { id: "card-1", owner_id: "buyer-1", location: "platform_vault", status: "sold" };
    control.rpcError = null;
    control.rpcCalls = [];
    control.userDbTokens = [];
  });

  it("POST /buyout body {cardId} selalu meneruskan destination platform_vault dan address null", async () => {
    const res = await request("/api/marketplace/buyout", "POST", { cardId: "card-1" });
    expect(res.status).toBe(201);
    expect(control.userDbTokens).toEqual(["buyer-jwt"]);
    expect(control.rpcCalls).toEqual([
      { fn: "buyout_card", args: { p_card_id: "card-1", p_destination: "platform_vault", p_address: null } },
    ]);
    expect(await res.json()).toMatchObject({ ok: true, card: { id: "card-1", location: "platform_vault" } });
  });

  it("destination buyer_address ditolak sebelum RPC", async () => {
    const res = await request("/api/marketplace/buyout", "POST", { cardId: "card-1", destination: "buyer_address" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it.each([1, 2])("harga buyout %i ditolak ketika create sebelum RPC", async (price) => {
    const res = await request("/api/marketplace", "POST", { cardId: "card-1", buyoutPriceCcoin: price });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it.each([1, 2])("harga buyout %i ditolak ketika update sebelum RPC", async (price) => {
    const res = await request("/api/marketplace/cards/card-1/buyout", "PATCH", { buyoutPriceCcoin: price });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it.each([
    ["CARD_NOT_IN_VAULT", "Kartu harus diterima di vault platform"],
    ["SHIPMENT_ACTIVE", "Sudah ada pengiriman aktif"],
  ])("RPC %s mengembalikan pesan yang dapat dibaca", async (code, message) => {
    control.rpcError = { message: code };
    const res = await request("/api/marketplace/buyout", "POST", { cardId: "card-1" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe(code);
    expect(body.error).toContain(message);
  });

  it("unauthenticated diblok sebelum membangun RPC", async () => {
    control.authError = 401;
    const res = await request("/api/marketplace/buyout", "POST", { cardId: "card-1" });
    expect(res.status).toBe(401);
    expect(control.rpcCalls).toHaveLength(0);
  });
});
