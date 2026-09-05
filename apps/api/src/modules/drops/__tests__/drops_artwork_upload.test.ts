import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  admin: true,
  dropExists: true,
  artworkUrl: "https://assets.c-verse.co/mock/v1/artworks/genesis.png",
  auditFails: false,
  auditCalls: [] as Array<Record<string, unknown>>,
  updatePatch: null as Record<string, unknown> | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: () =>
    control.admin
      ? Promise.resolve({ user: { id: "00000000-0000-4000-8000-000000000002", role: "admin" }, token: "admin-token" })
      : Promise.resolve({ error: 403, reason: "not_admin" }),
  requireUser: () => Promise.resolve({ error: 401 }),
  getOptionalUser: () => Promise.resolve(null),
  adminGateError: () => ({ body: { error: "Hanya admin" }, status: 403 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  getDropById: () =>
    Promise.resolve(
      control.dropExists
        ? {
            id: "drop-genesis-live",
            artworkUrl: control.artworkUrl,
            creatorId: "creator-1",
            status: "draft",
          }
        : null,
    ),
  listDrops: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
  listCards: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ action: args[1], targetTable: args[2], targetId: args[3], payload: args[4] });
    return control.auditFails ? Promise.reject(new Error("audit unavailable")) : Promise.resolve();
  },
}));
vi.mock("../../../lib/reads/users.js", () => ({ getUserById: () => Promise.resolve(null), listUsersByIds: () => Promise.resolve([]) }));

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
        maybeSingle: () => Promise.resolve({ data: { artwork_url: control.updatePatch?.artwork_url }, error: null }),
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
  view.setUint32(16, 1200);
  view.setUint32(20, 1600);
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
  form.set("file", new File([png()], "artwork.png", { type: "image/png" }));
  return app.request(
    "/api/drops/drop-genesis-live/artwork",
    { method: "POST", headers: { authorization: "Bearer admin-token" }, body: form },
    { ASSETS: bucket },
  );
}

describe("POST /api/drops/:id/artwork", () => {
  beforeEach(() => {
    control.admin = true;
    control.dropExists = true;
    control.artworkUrl = "https://assets.c-verse.co/mock/v1/artworks/genesis.png";
    control.auditFails = false;
    control.auditCalls = [];
    control.updatePatch = null;
  });

  it("allows only an active DB-verified admin and requires an existing drop", async () => {
    control.admin = false;
    const unauthorisedBucket = fakeBucket();
    expect((await upload(unauthorisedBucket)).status).toBe(403);
    expect(unauthorisedBucket.put).not.toHaveBeenCalled();

    control.admin = true;
    control.dropExists = false;
    const missingBucket = fakeBucket();
    expect((await upload(missingBucket)).status).toBe(404);
    expect(missingBucket.put).not.toHaveBeenCalled();
  });

  it("matches the parameterized upload rate-limit middleware", async () => {
    const bucket = fakeBucket();
    const form = new FormData();
    form.set("file", new File([png()], "artwork.png", { type: "image/png" }));
    const response = await app.request(
      "/api/drops/drop-genesis-live/artwork",
      { method: "POST", headers: { authorization: "Bearer admin-token" }, body: form },
      {
        ASSETS: bucket,
        ENV: "production",
        UPLOAD_RATE_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: false })) },
        GLOBAL_RATE_LIMITER: { limit: vi.fn(() => Promise.resolve({ success: true })) },
      },
    );
    expect(response.status).toBe(429);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("uploads an immutable drop-scoped key, CAS-updates the URL, and audits", async () => {
    const bucket = fakeBucket();
    const response = await upload(bucket);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { artworkUrl: string };
    expect(body.artworkUrl).toMatch(/^https:\/\/assets\.c-verse\.co\/drops\/drop-genesis-live\/artwork\/.+\.png$/);
    expect(vi.mocked(bucket.put).mock.calls[0]?.[0]).toMatch(/^drops\/drop-genesis-live\/artwork\/.+\.png$/);
    expect(control.updatePatch).toEqual({ artwork_url: body.artworkUrl });
    expect(control.auditCalls).toHaveLength(1);
    expect(control.auditCalls[0]).toMatchObject({
      action: "update",
      targetTable: "drops",
      targetId: "drop-genesis-live",
      payload: { operation: "update_artwork" },
    });
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("deletes only a superseded URL from this exact drop namespace", async () => {
    control.artworkUrl = "https://assets.c-verse.co/drops/drop-genesis-live/artwork/11111111-1111-4111-8111-111111111111.webp";
    const bucket = fakeBucket();
    expect((await upload(bucket)).status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith("drops/drop-genesis-live/artwork/11111111-1111-4111-8111-111111111111.webp");
  });

  it("does not mask committed success when audit logging fails", async () => {
    control.auditFails = true;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await upload(fakeBucket());
    expect(response.status).toBe(200);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
