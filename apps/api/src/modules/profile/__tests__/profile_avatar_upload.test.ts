import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const USER_ID = "00000000-0000-4000-8000-000000000001";
const control = vi.hoisted(() => ({
  authError: null as 401 | 403 | null,
  avatarUrl: null as string | null,
  casMode: "committed" as "committed" | "conflict" | "throw-old",
  maybeSingleCalls: 0,
  updatePatch: null as Record<string, unknown> | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => {
    if (control.authError)
      return Promise.resolve({ error: control.authError, reason: control.authError === 403 ? "suspended" : undefined });
    return Promise.resolve({
      user: {
        id: USER_ID,
        email: "user@cverse.id",
        displayName: "User",
        role: "user",
        username: "user",
        usernameIsAuto: false,
        avatarUrl: control.avatarUrl,
        totalXp: 0,
        isAnonymous: false,
      },
      token: "token",
    });
  },
  requireAdmin: () => Promise.resolve({ error: 403, reason: "not_admin" }),
  adminGateError: () => ({ body: { error: "Hanya admin" }, status: 403 }),
  getOptionalUser: () => Promise.resolve(null),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/bids.js", () => ({ listBids: () => Promise.resolve([]) }));
vi.mock("../../../lib/reads/drops.js", () => ({
  listCards: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
  listDrops: () => Promise.resolve([]),
  getDropById: () => Promise.resolve(null),
}));
vi.mock("../../../lib/reads/orders.js", () => ({
  listOrdersByUser: () => Promise.resolve([]),
  listShipmentsByRequester: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/profile.js", () => ({
  getWalletByUser: () => Promise.resolve({ balanceCCoin: 0 }),
  listUserBadges: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/kyc.js", () => ({
  getKycByUser: () => Promise.resolve(null),
  logAuditDb: () => Promise.resolve(),
}));
vi.mock("../../../lib/reads/users.js", () => ({
  getUserByUsername: () => Promise.resolve(null),
  getUserById: () => Promise.resolve(null),
  listUsersByIds: () => Promise.resolve([]),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => {
      const query: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => {
          control.updatePatch = patch;
          return query;
        },
        eq: () => query,
        is: () => query,
        select: () => query,
        maybeSingle: () => {
          control.maybeSingleCalls += 1;
          if (control.casMode === "throw-old" && control.maybeSingleCalls === 1) return Promise.reject(new Error("connection reset"));
          if (control.casMode === "throw-old") return Promise.resolve({ data: { avatar_url: control.avatarUrl }, error: null });
          return Promise.resolve({
            data: control.casMode === "committed" ? { avatar_url: control.updatePatch?.avatar_url ?? null } : null,
            error: null,
          });
        },
      };
      return query;
    },
  }),
  _resetSupabaseCache: () => undefined,
}));

const { app } = await import("../../../index.js");

function png(): ArrayBuffer {
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 2);
  view.setUint32(20, 3);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes[41] = 0;
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  return bytes.buffer;
}

function fakeBucket() {
  return {
    put: vi.fn(() => Promise.resolve({ key: "ok" })),
    delete: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(null)),
  } as unknown as R2Bucket;
}

function upload(bucket: R2Bucket) {
  const form = new FormData();
  form.set("file", new File([png()], "avatar.png", { type: "image/png" }));
  return app.request("/api/profile/avatar", { method: "POST", headers: { authorization: "Bearer token" }, body: form }, { ASSETS: bucket });
}

describe("public avatar API", () => {
  beforeEach(() => {
    control.authError = null;
    control.avatarUrl = null;
    control.casMode = "committed";
    control.maybeSingleCalls = 0;
    control.updatePatch = null;
  });

  it("uploads to an immutable caller key and CAS-updates avatar_url", async () => {
    const bucket = fakeBucket();
    const response = await upload(bucket);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { avatarUrl: string };
    expect(body.avatarUrl).toMatch(new RegExp(`^https://assets\\.c-verse\\.co/profiles/${USER_ID}/avatar/.+\\.png$`));
    expect(vi.mocked(bucket.put).mock.calls[0]?.[0]).toMatch(new RegExp(`^profiles/${USER_ID}/avatar/.+\\.png$`));
    expect(vi.mocked(bucket.put).mock.calls[0]?.[2]?.httpMetadata).toMatchObject({ contentType: "image/png", cacheControl: "no-store" });
    expect(control.updatePatch).toEqual({ avatar_url: body.avatarUrl });
  });

  it("requires auth before reading the body or writing R2", async () => {
    control.authError = 401;
    const bucket = fakeBucket();
    const response = await upload(bucket);
    expect(response.status).toBe(401);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rate-limits uploads before parsing or writing the file", async () => {
    const bucket = fakeBucket();
    const form = new FormData();
    form.set("file", new File([png()], "avatar.png", { type: "image/png" }));
    const response = await app.request(
      "/api/profile/avatar",
      { method: "POST", headers: { authorization: "Bearer token" }, body: form },
      {
        ASSETS: bucket,
        ENV: "production",
        UPLOAD_RATE_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: false })) },
      },
    );
    expect(response.status).toBe(429);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("removes the newly uploaded object on a definite CAS conflict", async () => {
    control.casMode = "conflict";
    const bucket = fakeBucket();
    const response = await upload(bucket);
    expect(response.status).toBe(409);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bucket.delete).mock.calls[0]?.[0]).toMatch(new RegExp(`^profiles/${USER_ID}/avatar/`));
  });

  it("retains the new object when a transport failure remains ambiguous after readback", async () => {
    control.casMode = "throw-old";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bucket = fakeBucket();
    const response = await upload(bucket);
    expect(response.status).toBe(503);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("public_asset_db_outcome_ambiguous"));
    errorLog.mockRestore();
  });

  it("attempts object cleanup when R2 put throws before any DB mutation", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bucket = fakeBucket();
    vi.mocked(bucket.put).mockRejectedValueOnce(new Error("R2 timeout"));
    const response = await upload(bucket);
    expect(response.status).toBe(503);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(control.updatePatch).toBeNull();
    errorLog.mockRestore();
  });

  it("never deletes an arbitrary external avatar URL", async () => {
    control.avatarUrl = "https://example.test/customer-avatar.png";
    const bucket = fakeBucket();
    const response = await app.request(
      "/api/profile/avatar",
      { method: "DELETE", headers: { authorization: "Bearer token" } },
      { ASSETS: bucket },
    );
    expect(response.status).toBe(200);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("exposes avatarUrl through profile and auth refresh responses", async () => {
    control.avatarUrl = "https://example.test/avatar.png";
    const profile = await app.request("/api/profile", { headers: { authorization: "Bearer token" } });
    expect(((await profile.json()) as { user: { avatarUrl: string } }).user.avatarUrl).toBe(control.avatarUrl);
    const auth = await app.request("/api/auth/me", { headers: { authorization: "Bearer token" } });
    expect(((await auth.json()) as { avatarUrl: string }).avatarUrl).toBe(control.avatarUrl);
  });
});
