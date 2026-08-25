import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  balance: 100,
  card: {
    id: "card-1",
    dropId: "drop-1",
    ownerId: "u-1",
    location: "platform_vault",
  } as { id: string; dropId: string; ownerId: string; location: string; qcStatus?: string },
  priorShipments: [] as Array<{ id: string; cardId: string; status: string }>,
  shipmentInsertError: null as { message: string } | null,
  rpcCalls: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
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

vi.mock("../../lib/reads/orders.js", () => ({
  getCardById: () => Promise.resolve(control.card),
  getOrderById: () => Promise.resolve(null),
  listOrdersByUser: () => Promise.resolve([]),
  listShipmentsByCards: () => Promise.resolve(control.priorShipments),
  listShipmentsByRequester: () => Promise.resolve([]),
  getShipmentById: () => Promise.resolve(null),
}));

vi.mock("../../lib/reads/profile.js", () => ({
  getKycByUser: () => Promise.resolve(null),
  getWalletByUser: () => Promise.resolve({ balanceCCoin: control.balance, holdPayoutUntil: null }),
  listUserBadges: () => Promise.resolve([]),
}));

vi.mock("../../lib/reads/drops.js", () => ({
  getDropById: () => Promise.resolve(null),
  listCardsByIds: () => Promise.resolve([]),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

// readDb() returns a thenable builder (for .from(...) reads)
vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        // For shipments.insert — used inside vault-shipout
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: () =>
              table === "shipments" && control.shipmentInsertError
                ? Promise.resolve({ data: null, error: control.shipmentInsertError })
                : Promise.resolve({ data: { id: row.id, ...row }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
      return builder;
    },
  }),
  _resetSupabaseCache: () => undefined,
}));

// userDb() lives in lib/db.js, not lib/supabase.js — mock it separately.
vi.mock("../../lib/db.js", () => ({
  userDb: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      control.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
  RpcError: class RpcError extends Error {},
}));

const { app } = await import("../../index.js");

function shipout(body: Record<string, unknown>) {
  return app.request("/api/orders/vault-shipout", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("vault-shipout unique-constraint rejection (M7 audit 2026-08-24)", () => {
  beforeEach(() => {
    control.balance = 100;
    control.card = { id: "card-1", dropId: "drop-1", ownerId: "u-1", location: "platform_vault" };
    control.priorShipments = [];
    control.shipmentInsertError = null;
    control.rpcCalls = [];
    control.auditCalls = [];
  });

  it("happy path: wallet debit + shipment insert + audit", async () => {
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan", feeCcoin: 5 });
    expect(res.status).toBe(200);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("wallet_debit");
    expect((control.rpcCalls[0]?.args as { p_amount?: number })?.p_amount).toBe(5);
  });

  it("DB rejects duplicate active shipment -> 409 (race-safe via partial unique index)", async () => {
    control.shipmentInsertError = {
      message: 'duplicate key value violates unique constraint "uq_shipments_active_per_card"',
    };
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan", feeCcoin: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Sudah ada pengiriman aktif untuk kartu ini");
    // No audit fired (the insert was rejected before reaching audit).
    expect(control.auditCalls).toHaveLength(0);
  });

  it("JS read-check 409 path still works (defense-in-depth, sequential requests)", async () => {
    control.priorShipments = [{ id: "ship-existing", cardId: "card-1", status: "requested" }];
    const res = await shipout({ cardId: "card-1", address: "Jl. Test 123, Jakarta Selatan", feeCcoin: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Sudah ada pengiriman aktif untuk kartu ini");
  });
});
