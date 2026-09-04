import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  payoutExists: true as boolean,
  payoutStatus: "pending" as string,
  payoutUserId: "creator-1",
  payoutAmount: 120,
  refundError: null as { code: string; message: string } | null,
  rpcCalls: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: () => {
    if (control.refundError?.code === "_AUTH_FAIL_") {
      return Promise.resolve({ error: 401 });
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
  adminGateError: (res: { error: number; reason?: string }) => {
    if (res.error === 401) return { body: { error: "Unauthorized" }, status: 401 };
    const msg = res.reason === "suspended" ? "Akun disuspend" : "Hanya admin";
    return { body: { error: msg }, status: 403 };
  },
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
    if (table === "payouts") {
      return {
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () =>
              control.payoutExists
                ? Promise.resolve({
                    data: {
                      id: "pay-1",
                      status: control.payoutStatus,
                      user_id: control.payoutUserId,
                      ccoin_amount: control.payoutAmount,
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
  const db = {
    from: fakeFrom,
    rpc: (fn: string, args: Record<string, unknown>) => {
      control.rpcCalls.push({ fn, args });
      if (control.refundError) {
        return Promise.resolve({ data: null, error: { message: `${control.refundError.code}\n${control.refundError.message}` } });
      }
      return Promise.resolve({
        data: { id: "pay-1", status: "refunded", user_id: control.payoutUserId, ccoin_amount: control.payoutAmount },
        error: null,
      });
    },
  };
  return { getSupabase: () => db };
});

const { app } = await import("../../../index.js");

function refundPayout() {
  return app.request("/api/payments/admin/payouts/pay-1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
}

describe("POST /api/payments/admin/payouts/:id/refund", () => {
  beforeEach(() => {
    control.payoutExists = true;
    control.payoutStatus = "pending";
    control.payoutUserId = "creator-1";
    control.payoutAmount = 120;
    control.refundError = null;
    control.rpcCalls = [];
    control.auditCalls = [];
  });

  it("refund sukses -> 200 {payout} + audit payout_refund dengan status_before/after", async () => {
    const res = await refundPayout();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payout: { id: string; status: string } };
    expect(body.payout.id).toBe("pay-1");
    expect(body.payout.status).toBe("refunded");
    expect(control.rpcCalls.length).toBe(1);
    expect(control.rpcCalls[0]).toMatchObject({ fn: "payout_refund", args: { p_payout_id: "pay-1" } });
    expect(control.auditCalls.length).toBe(1);
    const payload = control.auditCalls[0].args as unknown[];
    expect(payload[1]).toBe("payout_refund");
    expect(payload[2]).toBe("payouts");
    expect(payload[3]).toBe("pay-1");
    const summary = payload[4] as { action: string; status_before: string; status_after: string };
    expect(summary.action).toBe("payout_refund");
    expect(summary.status_before).toBe("pending");
    expect(summary.status_after).toBe("refunded");
  });

  it("payout tidak ditemukan -> 404 (no RPC, no audit)", async () => {
    control.payoutExists = false;
    const res = await refundPayout();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Payout");
    expect(control.rpcCalls.length).toBe(0);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC INVALID_STATE -> 409 (no audit)", async () => {
    control.refundError = { code: "INVALID_STATE", message: "Payout tidak bisa di-refund (status disbursed)" };
    const res = await refundPayout();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("tidak bisa di-refund");
    expect(control.auditCalls.length).toBe(0);
  });

  it("non-admin -> 401 (no RPC, no audit)", async () => {
    control.refundError = { code: "_AUTH_FAIL_", message: "" };
    const res = await refundPayout();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(control.rpcCalls.length).toBe(0);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC PERMISSION_DENIED (audit 2026-08-23: in-body guard bocor) -> 400 + tanpa audit", async () => {
    // payout_refund ditambah is_service_role() guard (paritas dengan release_seed_sale).
    // EXECUTE grant service_role only + guard in-body = defense-in-depth.
    control.refundError = {
      code: "PERMISSION_DENIED",
      message: "Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role",
    };
    const res = await refundPayout();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("service_role");
    expect(control.rpcCalls.length).toBe(1);
    expect(control.auditCalls.length).toBe(0);
  });
});
