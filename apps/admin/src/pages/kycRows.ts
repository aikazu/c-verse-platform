import { maskNik } from "../lib/utils";

// Kontrak GET /api/kyc/admin/all — hasil mapKycRow (apps/api/src/lib/reads.ts),
// camelCase. Halaman sebelumnya membaca field snake_case (r.user_id) sehingga
// render TypeError (e2e bug 2026-08-29).
export interface KycAdminRow {
  id: string;
  userId: string;
  fullName: string;
  nik: string;
  status: string;
  createdAt: string;
}

/** Pure mapper baris API -> sel tabel KYC (userShort, NIK termasking, label tanggal). */
export function kycRowToDisplay(row: KycAdminRow) {
  return {
    id: row.id,
    userShort: row.userId.slice(0, 8),
    fullName: row.fullName,
    maskedNik: maskNik(row.nik),
    status: row.status,
    submittedLabel: new Date(row.createdAt).toLocaleDateString("id-ID"),
  };
}
