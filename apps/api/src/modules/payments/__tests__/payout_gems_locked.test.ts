import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
  (globalThis as unknown as Record<string, string | undefined>).PAYOUT_WEBHOOK_SIGNING_KEY = "test-payout-signing-key";
});

const control = vi.hoisted(() => ({
  rpcData: null as unknown,
  rpcError: null as { message: string } | null,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => Promise.resolve({ user: { id: "11111111-1111-4111-8111-111111111111" }, token: "mock-token" }),
  requireAdmin: () => Promise.resolve({ user: { id: "22222222-2222-4222-8222-222222222222", role: "admin" }, token: "admin-token" }),
  getOptionalUser: () => Promise.resolve(null),
  authHeaderToToken: () => "mock-token",
  verifySupabaseJwt: () => Promise.resolve(null),
  adminGateError: (res: { error: 401 | 403; reason?: string }) =>
    res.error === 401 ? { body: { error: "Unauthorized" }, status: 401 } : { body: { error: "Hanya admin" }, status: 403 },
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

// Route tests mock lib/db.js (userDb transport), never lib/supabase.js.
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

function payout(body: Record<string, unknown>) {
  return app.request("/api/payments/payout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mock-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payments/payout — gems maturity error map", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcData = null;
    control.rpcError = null;
  });

  it("RpcError PAYOUT_GEMS_LOCKED -> 400 dengan headline Indonesia (bukan raw code)", async () => {
    control.rpcError = { message: "PAYOUT_GEMS_LOCKED" };
    const res = await payout({ amountCcoin: 25 });
    expect(res.status).toBe(400);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]?.fn).toBe("payout_request");
    expect(control.rpcCalls[0]?.args).toEqual({ p_amount: 25 });
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("PAYOUT_GEMS_LOCKED");
    expect(body.error).toContain("Gems masih dikunci");
  });

  it("error map lama tidak berubah: KYC_REQUIRED tetap 403 dengan pesan sama", async () => {
    control.rpcError = { message: "KYC_REQUIRED" };
    const res = await payout({ amountCcoin: 25 });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("KYC_REQUIRED");
    expect(body.error).toBe("KYC harus disetujui dulu sebelum payout (ajukan di /me/kyc)");
  });

  it("error map lama tidak berubah: MIN_PAYOUT tetap 400 dengan pesan sama", async () => {
    control.rpcError = { message: "MIN_PAYOUT" };
    const res = await payout({ amountCcoin: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("MIN_PAYOUT");
    expect(body.error).toBe("Payout minimum 10 C-Coin");
  });
});
