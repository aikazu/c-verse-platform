import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  authError: null as 401 | 403 | null,
  rpcData: {
    id: "ship-1",
    card_id: "card-1",
    requester_id: "u-1",
    type: "secondary_seller_to_vault",
    from_location: "with_owner",
    to_dest: "platform_vault",
    address: "Vault C.Verse, Jl. Industri No. 99, Jakarta",
    fee_ccoin: 0,
    status: "requested",
    tracking_number: "JNEX123456",
    platform_check: null,
    created_at: "2026-09-05T00:00:00.000Z",
  } as Record<string, unknown>,
  rpcError: null as { message: string; code?: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  userDbTokens: [] as string[],
  auditCalls: [] as unknown[][],
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    if (control.authError) return Promise.resolve({ error: control.authError });
    return Promise.resolve({
      user: { id: "u-1", email: "u@cverse.id", displayName: "User", role: "user" },
      token: "user-jwt",
    });
  },
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push(args);
    return Promise.resolve();
  },
}));

// Keep the real rpcSellerToVault wrapper and RpcError mapping. Only the
// user-scoped transport is captured, so the route boundary stays covered.
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

const BASE = {
  cardId: "card-1",
  address: "Vault C.Verse, Jl. Industri No. 99, Jakarta",
  trackingNumber: "JNEX123456",
};

function sellerToVault(body: Record<string, unknown>) {
  return app.request("/api/shipments/seller-to-vault", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer user-jwt" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/shipments/seller-to-vault — atomic seller_to_vault RPC", () => {
  beforeEach(() => {
    control.authError = null;
    control.rpcData = {
      id: "ship-1",
      card_id: "card-1",
      requester_id: "u-1",
      type: "secondary_seller_to_vault",
      from_location: "with_owner",
      to_dest: "platform_vault",
      address: BASE.address,
      fee_ccoin: 0,
      status: "requested",
      tracking_number: BASE.trackingNumber,
      platform_check: null,
      created_at: "2026-09-05T00:00:00.000Z",
    };
    control.rpcError = null;
    control.rpcCalls = [];
    control.userDbTokens = [];
    control.auditCalls = [];
  });

  it("meneruskan identitas user, card, address, dan tracking ke RPC; response serta audit tercatat", async () => {
    const res = await sellerToVault(BASE);
    expect(res.status).toBe(201);
    expect(control.userDbTokens).toEqual(["user-jwt"]);
    expect(control.rpcCalls).toEqual([
      {
        fn: "seller_to_vault",
        args: { p_card_id: "card-1", p_address: BASE.address, p_tracking: "JNEX123456" },
      },
    ]);
    const body = (await res.json()) as { ok: boolean; shipment: { id: string; cardId: string; trackingNumber: string | null } };
    expect(body).toMatchObject({ ok: true, shipment: { id: "ship-1", cardId: "card-1", trackingNumber: "JNEX123456" } });
    expect(control.auditCalls).toEqual([
      expect.arrayContaining(["u-1", "create", "shipments", "ship-1", { cardId: "card-1", type: "secondary_seller_to_vault" }]),
    ]);
  });

  it("seed bid_pending tetap diserahkan ke SQL, tanpa precheck route", async () => {
    const res = await sellerToVault(BASE);
    expect(res.status).toBe(201);
    expect(control.rpcCalls[0]).toMatchObject({ fn: "seller_to_vault" });
  });

  it("tanpa tracking meneruskan null", async () => {
    const { trackingNumber: _trackingNumber, ...withoutTracking } = BASE;
    const res = await sellerToVault(withoutTracking);
    expect(res.status).toBe(201);
    expect(control.rpcCalls[0]?.args).toMatchObject({ p_tracking: null });
  });

  it("unauthenticated atau suspended diblok sebelum RPC dan audit", async () => {
    for (const expected of [401, 403] as const) {
      control.authError = expected;
      const res = await sellerToVault(BASE);
      expect(res.status).toBe(expected);
      expect(control.rpcCalls).toHaveLength(0);
      expect(control.auditCalls).toHaveLength(0);
      control.authError = null;
    }
  });

  it.each([
    ["CARD_NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["CARD_NOT_TRADABLE", 400],
    ["SHIPMENT_ACTIVE", 409],
    ["SALE_IN_PROGRESS", 409],
    ["INVALID_TRANSITION", 409],
  ])("RPC %s dipetakan ke HTTP %i tanpa audit", async (code, expectedStatus) => {
    control.rpcError = { message: code };
    const res = await sellerToVault(BASE);
    expect(res.status).toBe(expectedStatus);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(code);
    expect(control.auditCalls).toHaveLength(0);
  });

  it("error RPC tak dikenal memakai pesan fallback yang disanitasi", async () => {
    control.rpcError = { message: "relation internal_payments does not exist", code: "42P01" };
    const res = await sellerToVault(BASE);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("internal_payments");
    expect(control.auditCalls).toHaveLength(0);
  });

  it("body invalid ditolak sebelum RPC", async () => {
    const res = await sellerToVault({ ...BASE, address: "singkat" });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(0);
  });
});
