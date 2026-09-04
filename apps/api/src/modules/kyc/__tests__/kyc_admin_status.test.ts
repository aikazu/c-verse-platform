import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  caller: "admin" as "admin" | "not_admin" | "suspended" | "unauthorized",
  current: null as null | Record<string, unknown>,
  setStatusCalls: [] as Array<{ id: string; status: string }>,
  auditCalls: [] as Array<{
    adminUserId: string;
    action: string;
    targetTable: string;
    targetId: string | null;
    payloadSummary: Record<string, unknown> | null;
  }>,
  kycList: [] as Array<Record<string, unknown>>,
  headAvailable: true,
  getAvailable: true,
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
  getKycById: () => Promise.resolve(control.current),
  listKycRecords: () => Promise.resolve(control.kycList),
  upsertKycSubmission: () => Promise.resolve(control.current),
  setKycStatus: (id: string, status: "approved" | "rejected") => {
    control.setStatusCalls.push({ id, status });
    return Promise.resolve(control.current ? { ...control.current, status } : null);
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
  getSupabase: () => ({ from: () => ({}) }),
}));

const { app } = await import("../../../index.js");

function baseRecord(): Record<string, unknown> {
  return {
    id: "kyc-1",
    userId: "user-1",
    fullName: "Budi Santoso",
    nik: "3201234567890001",
    address: "Jl. Merdeka No. 17, Jakarta",
    dob: "1990-05-12",
    status: "pending",
    createdAt: "2026-09-01T00:00:00.000Z",
    ktpObjectKey: "user-1/ktp-test.png",
    selfieObjectKey: "user-1/selfie-test.jpg",
    npwpObjectKey: null,
  };
}

function fakeBucket(): R2Bucket {
  const body = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  return {
    head: vi.fn(() => Promise.resolve(control.headAvailable ? ({} as R2Object) : null)),
    get: vi.fn(() =>
      Promise.resolve(
        control.getAvailable
          ? ({
              body: body.stream(),
              writeHttpMetadata(headers: Headers) {
                headers.set("Content-Type", "image/png");
              },
            } as R2ObjectBody)
          : null,
      ),
    ),
    put: vi.fn(() => Promise.resolve({} as R2Object)),
    delete: vi.fn(() => Promise.resolve()),
  } as unknown as R2Bucket;
}

function post(path: string, body?: unknown, bucket?: R2Bucket) {
  return app.request(
    `/api/kyc${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    bucket ? { KYC: bucket } : {},
  );
}

describe("admin KYC review and status", () => {
  beforeEach(() => {
    control.caller = "admin";
    control.current = baseRecord();
    control.kycList = [baseRecord()];
    control.setStatusCalls = [];
    control.auditCalls = [];
    control.headAvailable = true;
    control.getAvailable = true;
  });

  it("approves only after both required R2 objects exist", async () => {
    const bucket = fakeBucket();
    const res = await post("/kyc-1/approve", undefined, bucket);
    expect(res.status).toBe(200);
    expect(bucket.head).toHaveBeenCalledTimes(2);
    expect(control.setStatusCalls).toEqual([{ id: "kyc-1", status: "approved" }]);
    expect(control.auditCalls[0]?.payloadSummary).toEqual({ status: "approved" });
  });

  it("rejects approval when binding or required objects are missing", async () => {
    expect((await post("/kyc-1/approve")).status).toBe(503);

    control.headAvailable = false;
    expect((await post("/kyc-1/approve", undefined, fakeBucket())).status).toBe(409);
    expect(control.setStatusCalls).toHaveLength(0);
  });

  it("streams a private document with no-store headers and an audit entry", async () => {
    const res = await app.request("/api/kyc/admin/kyc-1/files/ktp", { headers: { Authorization: "Bearer t" } }, { KYC: fakeBucket() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(control.auditCalls[0]).toMatchObject({ action: "view_sensitive", payloadSummary: { document: "ktp" } });
  });

  it("does not expose R2 object keys in the admin list", async () => {
    const res = await app.request("/api/kyc/admin/all", { headers: { Authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc: Array<Record<string, unknown>> };
    expect(body.kyc[0]).not.toHaveProperty("ktpObjectKey");
    expect(body.kyc[0]).toMatchObject({ documents: { ktp: true, selfie: true, npwp: false } });
  });

  it("requires a meaningful rejection reason and audits a valid rejection", async () => {
    expect((await post("/kyc-1/reject", { reason: "ab" })).status).toBe(400);
    const res = await post("/kyc-1/reject", { reason: "  Foto KTP tidak jelas  " });
    expect(res.status).toBe(200);
    expect(control.setStatusCalls).toEqual([{ id: "kyc-1", status: "rejected" }]);
    expect(control.auditCalls[0]?.payloadSummary).toEqual({ status: "rejected", reason: "Foto KTP tidak jelas" });
  });

  it("blocks non-admin access before reading KYC data", async () => {
    control.caller = "not_admin";
    const res = await app.request("/api/kyc/admin/all", { headers: { Authorization: "Bearer t" } });
    expect(res.status).toBe(403);
    expect(control.auditCalls).toHaveLength(0);
  });
});
