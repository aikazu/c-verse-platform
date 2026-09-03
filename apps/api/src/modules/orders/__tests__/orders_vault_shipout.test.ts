import { SHIPMENT_FEE_CCOIN } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rpcData: { id: "ship-1", cardId: "card-1", type: "vault_shipout", status: "requested", feeCcoin: 2 } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  auditCalls: [] as Array<Record<string, unknown>>,
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

vi.mock("../../../lib/reads/orders.js", () => ({
  getCardById: () => Promise.resolve(null),
  getOrderById: () => Promise.resolve(null),
  listOrdersByUser: () => Promise.resolve([]),
  listShipmentsByCards: () => Promise.resolve([]),
  listShipmentsByRequester: () => Promise.resolve([]),
  getShipmentById: () => Promise.resolve(null),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

// Real rpcVaultShipout wrapper + real RpcError mapping; only the transport
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

function shipout(body: Record<string, unknown>) {
  return app.request("/api/orders/vault-shipout", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("vault-shipout — atomic RPC vault_shipout (founder 2026-08-28)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcData = { id: "ship-1", cardId: "card-1", type: "vault_shipout", status: "requested", feeCcoin: SHIPMENT_FEE_CCOIN };
    control.rpcError = null;
    control.auditCalls = [];
  });

  it("happy path: body tanpa feeCcoin — RPC vault_shipout dipanggil dengan { p_card_id, p_address } saja", async () => {
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan" });
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("vault_shipout");
    expect(control.rpcCalls[0]?.args).toEqual({
      p_card_id: "card-1",
      p_address: "Jl. Test 123, Jakarta Selatan",
    });
    const body = (await res.json()) as { ok: boolean; shipment: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.shipment.id).toBe("ship-1");
    expect(body.shipment.type).toBe("vault_shipout");
  });

  it("fee bukan input client: body dengan feeCcoin di-strip — RPC tetap tanpa p_fee_ccoin", async () => {
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan", feeCcoin: 999 });
    expect(res.status).toBe(200);
    expect(control.rpcCalls[0]?.args).toEqual({
      p_card_id: "card-1",
      p_address: "Jl. Test 123, Jakarta Selatan",
    });
  });

  it("audit payload memakai fee server SHIPMENT_FEE_CCOIN", async () => {
    await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan" });
    expect(control.auditCalls).toHaveLength(1);
    const callArgs = control.auditCalls[0]?.args as unknown[] | undefined;
    const detail = callArgs?.[4] as { cardId?: string; feeCcoin?: number };
    expect(detail).toEqual({ cardId: "card-1", feeCcoin: SHIPMENT_FEE_CCOIN });
  });

  it("RpcError INSUFFICIENT (saldo ongkir kurang) -> 402", async () => {
    control.rpcError = { message: "INSUFFICIENT" };
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan" });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INSUFFICIENT");
  });

  it("RpcError SHIPMENT_ACTIVE (duplikat aktif, race di SQL) -> 400 mapped (bukan raw DB message)", async () => {
    control.rpcError = { message: "SHIPMENT_ACTIVE" };
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("SHIPMENT_ACTIVE");
    expect(body.error).not.toContain("duplicate key");
  });

  it("zod tetap: address < 10 char ditolak 400 sebelum RPC", async () => {
    const res = await shipout({ cardId: "card-1", address: "jl" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });
});
