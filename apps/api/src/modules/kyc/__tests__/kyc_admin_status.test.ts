import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// P2-5: admin KYC status routes (POST /:id/approve, POST /:id/reject, GET /admin/all).
// requireAdmin di-mock per-mode, tapi adminGateError DIBIARKAN asli (via importOriginal)
// supaya pemetaan 401/403 -> body benar-benar diuji, bukan di-hardcode.
const control = vi.hoisted(() => ({
  caller: "admin" as "admin" | "not_admin" | "suspended" | "unauthorized",
  setStatusResult: { id: "kyc-1", user_id: "user-1", status: "approved" } as Record<string, unknown> | null,
  setStatusCalls: [] as Array<{ id: string; status: string }>,
  auditCalls: [] as Array<{
    adminUserId: string;
    action: string;
    targetTable: string;
    targetId: string | null;
    payloadSummary: Record<string, unknown> | null;
  }>,
  listCalls: 0,
  kycList: [{ id: "kyc-1", status: "pending" }] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth.js")>();
  const adminUser = {
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
  };
  return {
    ...actual,
    requireAdmin: () => {
      if (control.caller === "admin") return Promise.resolve({ user: adminUser, token: "t" });
      if (control.caller === "not_admin") return Promise.resolve({ error: 403 as const, reason: "not_admin" as const });
      if (control.caller === "suspended") return Promise.resolve({ error: 403 as const, reason: "suspended" as const });
      return Promise.resolve({ error: 401 as const });
    },
    tokenFingerprint: () => Promise.resolve("sha256:test"),
    clientIp: () => "127.0.0.1",
  };
});

vi.mock("../../../lib/reads/kyc.js", () => ({
  getKycByUser: () => Promise.resolve(null),
  listKycRecords: () => {
    control.listCalls += 1;
    return Promise.resolve(control.kycList);
  },
  upsertKycSubmission: () => Promise.resolve(control.setStatusResult),
  setKycStatus: (id: string, status: "approved" | "rejected") => {
    control.setStatusCalls.push({ id, status });
    return Promise.resolve(control.setStatusResult);
  },
  logAuditDb: (
    adminUserId: string,
    action: string,
    targetTable: string,
    targetId: string | null,
    payloadSummary: Record<string, unknown> | null,
  ) => {
    control.auditCalls.push({ adminUserId, action, targetTable, targetId, payloadSummary });
    return Promise.resolve();
  },
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { app } = await import("../../../index.js");

function post(path: string, body?: unknown) {
  return app.request(`/api/kyc${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/kyc/:id/approve | :id/reject (admin KYC status, P2-5)", () => {
  beforeEach(() => {
    control.caller = "admin";
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "approved" };
    control.setStatusCalls = [];
    control.auditCalls = [];
    control.listCalls = 0;
  });

  it("admin approve -> 200, setKycStatus(id, 'approved'), audit append (update/kyc_records/status approved)", async () => {
    const res = await post("/kyc-1/approve");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc?: { id: string; status: string } };
    expect(body.kyc).toMatchObject({ id: "kyc-1", status: "approved" });
    expect(control.setStatusCalls).toEqual([{ id: "kyc-1", status: "approved" }]);
    expect(control.auditCalls).toHaveLength(1);
    expect(control.auditCalls[0]).toMatchObject({
      adminUserId: "admin-1",
      action: "update",
      targetTable: "kyc_records",
      targetId: "kyc-1",
      payloadSummary: { status: "approved" },
    });
  });

  // Lane P2: reason penolakan WAJIB (trim, min 3, maks 1000) — audit trail
  // tidak boleh berakhir dengan reason:null. Tanpa body / kosong / terlalu
  // pendek → 400 tanpa perubahan status dan tanpa audit append.
  it("admin reject tanpa body -> 400, tanpa perubahan status, tanpa audit", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Alasan penolakan wajib diisi (min 3 karakter)");
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });

  it("admin reject dengan reason kosong -> 400", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject", { reason: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Alasan penolakan wajib diisi (min 3 karakter)");
    expect(control.setStatusCalls).toHaveLength(0);
  });

  it("admin reject dengan reason < 3 karakter -> 400", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject", { reason: "ab" });
    expect(res.status).toBe(400);
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });

  it("admin reject dengan reason whitespace saja -> 400", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject", { reason: "   " });
    expect(res.status).toBe(400);
    expect(control.setStatusCalls).toHaveLength(0);
  });

  it("admin reject dengan reason > 1000 karakter -> 400 tanpa perubahan status", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject", { reason: "a".repeat(1001) });
    expect(res.status).toBe(400);
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });

  // Audit batch 3 (lane I): reason penolakan ikut ke audit payload —
  // sebelumnya reviewer tidak bisa mengetahui ALASAN penolakan dari audit log.
  it("admin reject dengan reason valid -> 200, setKycStatus rejected, audit payload membawa reason (trim)", async () => {
    control.setStatusResult = { id: "kyc-1", user_id: "user-1", status: "rejected" };
    const res = await post("/kyc-1/reject", { reason: "  Foto KTP tidak jelas  " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc?: { id: string; status: string } };
    expect(body.kyc).toMatchObject({ id: "kyc-1", status: "rejected" });
    expect(control.setStatusCalls).toEqual([{ id: "kyc-1", status: "rejected" }]);
    expect(control.auditCalls).toHaveLength(1);
    expect(control.auditCalls[0]?.payloadSummary).toEqual({ status: "rejected", reason: "Foto KTP tidak jelas" });
  });

  it("unknown record id -> 404 and NO audit append", async () => {
    control.setStatusResult = null;
    const res = await post("/missing/approve");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Not found");
    expect(control.auditCalls).toHaveLength(0);
  });

  it("non-admin caller -> 403 'Hanya admin' (real adminGateError mapping), no status change, no audit", async () => {
    control.caller = "not_admin";
    const res = await post("/kyc-1/approve");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Hanya admin");
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });

  it("suspended caller -> 403 'Akun disuspend', no status change", async () => {
    control.caller = "suspended";
    const res = await post("/kyc-1/approve");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Akun disuspend");
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });

  it("unauthenticated caller -> 401, no status change, no audit", async () => {
    control.caller = "unauthorized";
    const res = await post("/kyc-1/approve");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Unauthorized");
    expect(control.setStatusCalls).toHaveLength(0);
    expect(control.auditCalls).toHaveLength(0);
  });
});

describe("GET /api/kyc/admin/all (admin KYC list)", () => {
  beforeEach(() => {
    control.caller = "admin";
    control.listCalls = 0;
  });

  it("admin -> 200 with the record list (listKycRecords called once)", async () => {
    const res = await app.request("/api/kyc/admin/all", { headers: { Authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc: Array<{ id: string }> };
    expect(body.kyc).toHaveLength(1);
    expect(body.kyc[0]?.id).toBe("kyc-1");
    expect(control.listCalls).toBe(1);
  });

  it("non-admin -> 403 'Hanya admin' and the list is never read", async () => {
    control.caller = "not_admin";
    const res = await app.request("/api/kyc/admin/all", { headers: { Authorization: "Bearer t" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Hanya admin");
    expect(control.listCalls).toBe(0);
  });
});
