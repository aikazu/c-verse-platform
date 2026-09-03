import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  cardExists: true as boolean,
  cardStatus: "bid_pending" as string,
  cancelError: null as { code: string; message: string } | null,
  cancelReject: null as Error | null,
  cancelResult: {
    cardId: "card-seed-1",
    refundedCcoin: 50,
    buyerId: "buyer-1",
    path: "buyout",
  } as Record<string, unknown>,
  auditCalls: [] as Record<string, unknown>[],
  isAdmin: true as boolean,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: () => {
    if (!control.isAdmin) {
      return Promise.resolve({
        error: { code: "FORBIDDEN", message: "bukan admin" },
      });
    }
    return Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "t",
    });
  },
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

vi.mock("../../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "cards") {
      return {
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () =>
              control.cardExists
                ? Promise.resolve({
                    data: {
                      id: "card-seed-1",
                      status: control.cardStatus,
                      location: "with_owner",
                      verify_status: "registered",
                      drop_id: "drop-seed-1",
                    },
                    error: null,
                  })
                : Promise.resolve({ data: null, error: null }),
          };
          return builder;
        },
      };
    }
    return { select: () => ({}) };
  });
  const db = { from: fakeFrom };
  return { getSupabase: () => db };
});

// rpcCancelSeedSale → db.rpc('cancel_seed_sale') — dikontrol via cancelError.
vi.mock("../../../lib/db.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../lib/db.js")>();
  return {
    ...mod,
    RpcError: mod.RpcError,
    rpcCancelSeedSale: vi.fn(async () => {
      if (control.cancelReject) throw control.cancelReject;
      if (control.cancelError) throw new mod.RpcError(control.cancelError.code, control.cancelError.message);
      return control.cancelResult;
    }),
    rpcReleaseSeedSale: vi.fn(async () => ({})),
  };
});

const { app } = await import("../../../index.js");

function cancelSeedSale() {
  return app.request("/api/admin/cards/card-seed-1/cancel-seed-sale", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
}

describe("POST /api/admin/cards/:id/cancel-seed-sale", () => {
  beforeEach(() => {
    control.cardExists = true;
    control.cardStatus = "bid_pending";
    control.cancelError = null;
    control.cancelReject = null;
    control.cancelResult = {
      cardId: "card-seed-1",
      refundedCcoin: 50,
      buyerId: "buyer-1",
      path: "buyout",
    };
    control.auditCalls = [];
    control.isAdmin = true;
  });

  it("abort sukses -> 200 dengan summary + audit seed_sale_abort", async () => {
    const res = await cancelSeedSale();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.cardId).toBe("card-seed-1");
    expect(body.refundedCcoin).toBe(50);
    expect(body.buyerId).toBe("buyer-1");
    expect(body.path).toBe("buyout");
    expect(control.auditCalls.length).toBe(1);
    const payload = control.auditCalls[0].args as unknown[];
    expect(payload[1]).toBe("update");
    expect(payload[2]).toBe("cards");
    expect(payload[3]).toBe("card-seed-1");
    const summary = payload[4] as {
      action: string;
      status_before: string;
      refundedCcoin: number;
      buyerId: string;
      path: string;
    };
    expect(summary.action).toBe("seed_sale_abort");
    expect(summary.status_before).toBe("bid_pending");
    expect(summary.refundedCcoin).toBe(50);
    expect(summary.buyerId).toBe("buyer-1");
    expect(summary.path).toBe("buyout");
  });

  it("kartu tidak ditemukan -> 404 (tanpa audit)", async () => {
    control.cardExists = false;
    const res = await cancelSeedSale();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Kartu tidak ditemukan");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC NO_PENDING_SALE -> 409 (tanpa audit)", async () => {
    control.cancelError = {
      code: "NO_PENDING_SALE",
      message: "Tidak ada transaksi seed yang menunggu release untuk kartu ini",
    };
    const res = await cancelSeedSale();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("seed");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC NOT_SEED_CARD -> 400 (tanpa audit)", async () => {
    control.cancelError = { code: "NOT_SEED_CARD", message: "Kartu bukan Creator Seed C.Card" };
    const res = await cancelSeedSale();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Creator Seed");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC PERMISSION_DENIED (guard service_role bocor) -> 400 + tanpa audit", async () => {
    // Audit 2026-08-23: cancel_seed_sale body menambah is_service_role() guard.
    // EXECUTE grant service_role only + guard in-body = defense-in-depth.
    control.cancelError = {
      code: "PERMISSION_DENIED",
      message: "Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role",
    };
    const res = await cancelSeedSale();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("service_role");
    expect(control.auditCalls.length).toBe(0);
  });

  it("non-admin -> 401", async () => {
    control.isAdmin = false;
    const res = await cancelSeedSale();
    expect(res.status).toBe(401);
    expect(control.auditCalls.length).toBe(0);
  });

  // Lane E (audit 2026-08-31): non-RpcError catch-all used to echo raw
  // err.message/String(err) — must go through sanitizeDbError.
  it("non-RpcError DB failure -> 400 sanitized (raw text tidak bocor)", async () => {
    control.cancelReject = new Error("could not serialize access due to concurrent update");
    const res = await cancelSeedSale();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("serialize");
  });
});
