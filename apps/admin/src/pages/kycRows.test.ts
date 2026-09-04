import { describe, expect, it } from "vitest";
import { type KycAdminRow, kycRowToDisplay } from "./kycRows";

// Pure-logic tests untuk mapping baris KYC admin (pola workQueue.test.ts):
// no DOM, no supabase. GET /api/kyc/admin/all mengembalikan hasil mapKycRow
// (apps/api/src/lib/reads.ts) — CAMELCASE. Halaman lama membaca field
// snake_case (r.user_id) sehingga render TypeError (e2e bug 2026-08-29).

const apiRow: KycAdminRow = {
  id: "kyc-0001",
  userId: "a1b2c3d4e5f6a7b8",
  fullName: "Iqbal Attila",
  nik: "3175012345670001",
  address: "Jl. Contoh No. 1, Jakarta",
  dob: "1990-01-01",
  status: "pending",
  createdAt: "2026-08-29T04:00:00.000Z",
  documents: { ktp: true, selfie: true, npwp: false },
};

describe("kycRowToDisplay", () => {
  it("membaca field camelCase dari API (mapKycRow) — bukan snake_case baris DB", () => {
    const view = kycRowToDisplay(apiRow);
    expect(view.id).toBe("kyc-0001");
    expect(view.userShort).toBe("a1b2c3d4");
    expect(view.fullName).toBe("Iqbal Attila");
  });

  it("menyamarkan NIK (UU PDP) dan memformat tanggal ajuan", () => {
    const view = kycRowToDisplay(apiRow);
    expect(view.maskedNik).toBe("•••• •••• •••• 0001");
    expect(view.submittedLabel).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it("meneruskan status apa adanya untuk StatusBadge kind=kyc", () => {
    expect(kycRowToDisplay({ ...apiRow, status: "approved" }).status).toBe("approved");
    expect(kycRowToDisplay({ ...apiRow, status: "rejected" }).status).toBe("rejected");
  });
});
