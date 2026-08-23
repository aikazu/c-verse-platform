import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  cardExists: true as boolean,
  releaseError: null as { code: string; message: string } | null,
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../lib/auth.js", () => ({
  requireAdmin: () =>
    Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        xp: 0,
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
    }),
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

vi.mock("../../lib/supabase.js", () => {
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
                      status: "bid_pending",
                      location: "platform_vault",
                      verify_status: "verified",
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

// rpcReleaseSeedSale → db.rpc('release_seed_sale') — dikontrol via releaseError.
vi.mock("../../lib/db.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/db.js")>();
  return {
    ...mod,
    RpcError: mod.RpcError,
    rpcReleaseSeedSale: vi.fn(async () => {
      if (control.releaseError) throw new mod.RpcError(control.releaseError.code, control.releaseError.message);
    }),
  };
});

const { app } = await import("../../index.js");

function releaseSeedSale() {
  return app.request("/api/admin/cards/card-seed-1/release-seed-sale", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
}

describe("POST /api/admin/cards/:id/release-seed-sale", () => {
  beforeEach(() => {
    control.cardExists = true;
    control.releaseError = null;
    control.auditCalls = [];
  });

  it("release sukses -> 200 {ok:true, cardId} + audit release_seed_sale", async () => {
    const res = await releaseSeedSale();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cardId: string };
    expect(body.ok).toBe(true);
    expect(body.cardId).toBe("card-seed-1");
    expect(control.auditCalls.length).toBe(1);
    const payload = control.auditCalls[0].args as unknown[];
    expect(payload[1]).toBe("update");
    expect(payload[2]).toBe("cards");
    expect(payload[3]).toBe("card-seed-1");
    const summary = payload[4] as { action: string; status_before: string };
    expect(summary.action).toBe("release_seed_sale");
    expect(summary.status_before).toBe("bid_pending");
  });

  it("kartu tidak ditemukan -> 404 (tanpa audit)", async () => {
    control.cardExists = false;
    const res = await releaseSeedSale();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Kartu tidak ditemukan");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC SEED_VAULT_IN_REQUIRED -> 409 (tanpa audit)", async () => {
    control.releaseError = {
      code: "SEED_VAULT_IN_REQUIRED",
      message: "Kartu seed wajib masuk vault platform + terverifikasi NFC sebelum release",
    };
    const res = await releaseSeedSale();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("vault");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC NO_PENDING_SALE -> 409", async () => {
    control.releaseError = { code: "NO_PENDING_SALE", message: "Tidak ada transaksi seed yang menunggu release untuk kartu ini" };
    const res = await releaseSeedSale();
    expect(res.status).toBe(409);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC NOT_SEED_CARD -> 400", async () => {
    control.releaseError = { code: "NOT_SEED_CARD", message: "Kartu bukan Creator Seed C.Card" };
    const res = await releaseSeedSale();
    expect(res.status).toBe(400);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC PERMISSION_DENIED (guard service_role bocor) -> 400 + tanpa audit", async () => {
    // Audit 2026-08-23: release_seed_sale body menambah is_service_role() guard.
    // EXECUTE grant service_role only + guard in-body = defense-in-depth.
    control.releaseError = {
      code: "PERMISSION_DENIED",
      message: "Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role",
    };
    const res = await releaseSeedSale();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("service_role");
    expect(control.auditCalls.length).toBe(0);
  });
});
