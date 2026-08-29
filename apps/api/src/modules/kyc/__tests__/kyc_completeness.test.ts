import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  upsertedRow: null as null | Record<string, unknown>,
  existing: null as null | { id: string; status: string },
  responseStatus: "pending",
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@x.id",
        displayName: "U One",
        role: "user",
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
      aal: "aal1",
    }),
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

function submit(body: Record<string, unknown>) {
  return app.request("/api/kyc", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  fullName: "Budi Santoso",
  nik: "3201234567890001",
  address: "Jl. Merdeka No. 17, Jakarta",
  dob: "1990-05-12",
  ktpUrl: "https://example.supabase.co/storage/v1/object/sign/kyc-files/u-1/ktp.jpg",
  selfieUrl: "https://example.supabase.co/storage/v1/object/sign/kyc-files/u-1/selfie.jpg",
  npwpUrl: undefined,
};

describe("POST /api/kyc (audit P0-5 completeness)", () => {
  beforeEach(() => {
    control.upsertedRow = null;
    control.existing = null;
    control.responseStatus = "pending";
  });

  it("payload lengkap (DOB + KTP + selfie) → 201 dan row berisi dob/ktp_url/selfie_url", async () => {
    const res = await submit(BASE);
    expect(res.status).toBe(201);
    expect(control.upsertedRow?.dob).toBe("1990-05-12");
    expect(control.upsertedRow?.ktp_url).toContain("ktp.jpg");
    expect(control.upsertedRow?.selfie_url).toContain("selfie.jpg");
  });

  it("payload tanpa dob → 400", async () => {
    const res = await submit({ ...BASE, dob: undefined });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/DOB|KTP|selfie/i);
  });

  it("payload tanpa ktpUrl → 400", async () => {
    const res = await submit({ ...BASE, ktpUrl: undefined });
    expect(res.status).toBe(400);
  });

  it("payload tanpa selfieUrl → 400", async () => {
    const res = await submit({ ...BASE, selfieUrl: undefined });
    expect(res.status).toBe(400);
  });

  it("npwpUrl opsional — payload tanpa npwp tetap 201", async () => {
    const res = await submit(BASE);
    expect(res.status).toBe(201);
    expect(control.upsertedRow?.npwp_url).toBeNull();
  });

  it("NIK harus length 16 (zValidator) → 400 saat 15 digit", async () => {
    const res = await submit({ ...BASE, nik: "123456789012345" });
    expect(res.status).toBe(400);
  });
});
