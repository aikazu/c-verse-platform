import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  upsertedRow: null as null | Record<string, unknown>,
  existing: null as null | Record<string, unknown>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "u@x.id",
        displayName: "U One",
        role: "user",
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
      aal: "aal1",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "kyc_records") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: control.existing, error: null }),
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          control.upsertedRow = row;
          return Promise.resolve({ error: null });
        },
      };
    }
    return { select: () => ({}) };
  });
  return { getSupabase: () => ({ from: fakeFrom }), readDb: () => ({ from: fakeFrom }) };
});

const { app } = await import("../../../index.js");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

function fakeBucket() {
  return {
    put: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(null)),
    head: vi.fn(() => Promise.resolve(null)),
  } as unknown as R2Bucket;
}

function validForm(): FormData {
  const form = new FormData();
  form.set("fullName", "Budi Santoso");
  form.set("nik", "3201234567890001");
  form.set("address", "Jl. Merdeka No. 17, Jakarta");
  form.set("dob", "1990-05-12");
  form.set("ktp", new File([PNG], "ktp.png", { type: "image/png" }));
  form.set("selfie", new File([JPEG], "selfie.jpg", { type: "image/jpeg" }));
  return form;
}

function submit(form: FormData, bucket?: R2Bucket) {
  return app.request("/api/kyc", { method: "POST", headers: { Authorization: "Bearer t" }, body: form }, bucket ? { KYC: bucket } : {});
}

describe("POST /api/kyc — private R2 upload", () => {
  beforeEach(() => {
    control.upsertedRow = null;
    control.existing = null;
  });

  it("uploads KTP and selfie to caller-scoped R2 keys, then stores only object keys", async () => {
    const bucket = fakeBucket();
    const res = await submit(validForm(), bucket);
    expect(res.status).toBe(201);
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(control.upsertedRow?.ktp_object_key).toMatch(/^00000000-0000-4000-8000-000000000001\/ktp-.+\.png$/);
    expect(control.upsertedRow?.selfie_object_key).toMatch(/^00000000-0000-4000-8000-000000000001\/selfie-.+\.jpg$/);
    expect(control.upsertedRow?.npwp_object_key).toBeNull();
  });

  it("does not expose private R2 object keys in the owner response", async () => {
    const res = await submit(validForm(), fakeBucket());
    const body = (await res.json()) as { kyc: Record<string, unknown> };
    expect(body.kyc.nik).toBe("************0001");
    expect(body.kyc).not.toHaveProperty("ktpObjectKey");
    expect(body.kyc).not.toHaveProperty("selfieObjectKey");
  });

  it("returns 503 and performs no DB write when the R2 binding is missing", async () => {
    const res = await submit(validForm());
    expect(res.status).toBe(503);
    expect(control.upsertedRow).toBeNull();
  });

  it("requires DOB, KTP, and selfie", async () => {
    const withoutDob = validForm();
    withoutDob.delete("dob");
    expect((await submit(withoutDob, fakeBucket())).status).toBe(400);

    const withoutKtp = validForm();
    withoutKtp.delete("ktp");
    expect((await submit(withoutKtp, fakeBucket())).status).toBe(400);

    const withoutSelfie = validForm();
    withoutSelfie.delete("selfie");
    expect((await submit(withoutSelfie, fakeBucket())).status).toBe(400);
  });

  it("rejects non-numeric or short NIK", async () => {
    const alphabetic = validForm();
    alphabetic.set("nik", "abcdefghijklmnop");
    expect((await submit(alphabetic, fakeBucket())).status).toBe(400);

    const short = validForm();
    short.set("nik", "123456789012345");
    expect((await submit(short, fakeBucket())).status).toBe(400);
  });

  it("rejects files whose magic bytes do not match the declared MIME type", async () => {
    const form = validForm();
    form.set("ktp", new File([JPEG], "fake.png", { type: "image/png" }));
    const bucket = fakeBucket();
    const res = await submit(form, bucket);
    expect(res.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects a KYC file larger than 5 MiB before writing to R2", async () => {
    const form = validForm();
    form.set("ktp", new File([PNG, new Uint8Array(5 * 1024 * 1024)], "large.png", { type: "image/png" }));
    const bucket = fakeBucket();
    const res = await submit(form, bucket);
    expect(res.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("waits for parallel uploads and removes all new keys when one R2 put fails", async () => {
    const bucket = fakeBucket();
    vi.mocked(bucket.put).mockRejectedValueOnce(new Error("R2 unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await submit(validForm(), bucket);
    expect(res.status).toBe(500);
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bucket.delete).mock.calls[0]?.[0]).toHaveLength(2);
    expect(control.upsertedRow).toBeNull();
    errorLog.mockRestore();
  });

  it("rejects PDF for selfie but accepts optional PDF for NPWP", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const invalid = validForm();
    invalid.set("selfie", new File([pdf], "selfie.pdf", { type: "application/pdf" }));
    expect((await submit(invalid, fakeBucket())).status).toBe(400);

    const valid = validForm();
    valid.set("npwp", new File([pdf], "npwp.pdf", { type: "application/pdf" }));
    const res = await submit(valid, fakeBucket());
    expect(res.status).toBe(201);
    expect(control.upsertedRow?.npwp_object_key).toMatch(/\/npwp-.+\.pdf$/);
  });
});
