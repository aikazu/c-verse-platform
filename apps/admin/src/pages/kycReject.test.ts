import { describe, expect, it } from "vitest";
import { buildKycRejectBody, kycRejectConfirmMessage, normalizeKycRejectReason } from "./kycReject";

// Pure-logic tests untuk alur tolak KYC admin (pola kycRows.test.ts):
// no DOM, no supabase. API POST /api/kyc/:id/reject menerima `reason` opsional
// (backward-compat body kosong) dan menuliskannya ke audit payload —
// lihat apps/api/src/modules/kyc/routes.ts.

describe("normalizeKycRejectReason", () => {
  it("memotong spasi di awal/akhir", () => {
    expect(normalizeKycRejectReason("  Foto KTP tidak jelas  ")).toBe("Foto KTP tidak jelas");
  });

  it("alasan kosong / whitespace-only -> null (wajib diisi)", () => {
    expect(normalizeKycRejectReason("")).toBeNull();
    expect(normalizeKycRejectReason("   ")).toBeNull();
  });

  it("alasan lebih dari 1000 karakter -> null (batas sama dengan API)", () => {
    expect(normalizeKycRejectReason("a".repeat(1001))).toBeNull();
    expect(normalizeKycRejectReason("a".repeat(1000))).toBe("a".repeat(1000));
  });
});

describe("buildKycRejectBody", () => {
  it("selalu membawa reason yang sudah dinormalisasi", () => {
    expect(buildKycRejectBody("  Dokumen tidak sesuai ")).toEqual({ reason: "Dokumen tidak sesuai" });
  });
});

describe("kycRejectConfirmMessage", () => {
  it("menampilkan alasan persis sebelum aksi irreversible dijalankan", () => {
    expect(kycRejectConfirmMessage("Data tidak cocok")).toContain("Data tidak cocok");
  });
});
