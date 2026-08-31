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

function submit(body: Record<string, unknown>) {
  return app.request("/api/kyc", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

// Lane P2 (regression fix): web uploadKycFile mengembalikan STORAGE PATH bucket
// kyc-files (`${userId}/${kind}-${ts}.${ext}`), bukan URL — `.url()` membatalkan
// semua submission. Kontrak baru: path caller-scoped (diawali `${user.id}/`),
// charset aman, tanpa traversal.
const BASE = {
  fullName: "Budi Santoso",
  nik: "3201234567890001",
  address: "Jl. Merdeka No. 17, Jakarta",
  dob: "1990-05-12",
  ktpUrl: "u-1/ktp-1725060000000.jpg",
  selfieUrl: "u-1/selfie-1725060000000.jpg",
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
    expect(control.upsertedRow?.ktp_url).toBe("u-1/ktp-1725060000000.jpg");
    expect(control.upsertedRow?.selfie_url).toBe("u-1/selfie-1725060000000.jpg");
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

  // Audit batch 2 F7: NIK alfabetik dulu lolos (.length(16) saja) lalu tidak
  // ter-mask redactNik — validasi write-side wajib ^\d{16}$.
  it("NIK alfabetik → 400", async () => {
    const res = await submit({ ...BASE, nik: "abcdefghijklmnop" });
    expect(res.status).toBe(400);
  });

  it("NIK campuran digit+huruf → 400", async () => {
    const res = await submit({ ...BASE, nik: "320123456789000X" });
    expect(res.status).toBe(400);
  });

  it("NIK valid → 201 dan NIK ter-mask di respons", async () => {
    const res = await submit(BASE);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { kyc: { nik: string } };
    expect(body.kyc.nik).toBe("************0001");
    expect(body.kyc.nik).not.toContain("3201234567890001");
  });

  // Lane P2 (regression fix): ktpUrl/selfieUrl adalah storage path — bukan URL.
  // Path dari uid lain / traversal / charset liar harus ditolak 400.
  it("ktpUrl path milik user lain → 400", async () => {
    const res = await submit({ ...BASE, ktpUrl: "someone-else/ktp-1.jpg" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Path file KYC tidak valid");
  });

  it("selfieUrl path milik user lain → 400", async () => {
    const res = await submit({ ...BASE, selfieUrl: "someone-else/selfie-1.jpg" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Path file KYC tidak valid");
  });

  it("npwpUrl path milik user lain → 400 (opsional tapi tetap caller-scoped)", async () => {
    const res = await submit({ ...BASE, npwpUrl: "someone-else/npwp-1.pdf" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Path file KYC tidak valid");
  });

  it("path traversal ../ → 400", async () => {
    const res = await submit({ ...BASE, ktpUrl: "u-1/../../other-user/ktp.jpg" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Path file KYC tidak valid");
  });

  it("karakter di luar whitelist (query/encoded) → 400", async () => {
    const res = await submit({ ...BASE, ktpUrl: "u-1/ktp.jpg?token=abc" });
    expect(res.status).toBe(400);
  });

  it("path milik sendiri → 201 dan tersimpan apa adanya", async () => {
    const res = await submit(BASE);
    expect(res.status).toBe(201);
    expect(control.upsertedRow?.ktp_url).toBe("u-1/ktp-1725060000000.jpg");
    expect(control.upsertedRow?.selfie_url).toBe("u-1/selfie-1725060000000.jpg");
  });

  it("ktpUrl kosong → 400", async () => {
    const res = await submit({ ...BASE, ktpUrl: "" });
    expect(res.status).toBe(400);
  });
});
