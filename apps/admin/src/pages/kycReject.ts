// Pure helpers untuk alur tolak KYC admin (pola kycRows.ts): API
// POST /api/kyc/:id/reject menerima `reason` opsional (backward-compat body
// kosong) dan menuliskannya ke audit payload —
// lihat apps/api/src/modules/kyc/routes.ts.

/** Harus sama dengan batas z.string().max(1000) di routes.ts sisi API. */
export const KYC_REJECT_REASON_MAX = 1000;

/** Trim alasan penolakan; null saat kosong atau melewati batas API (submit diblokir di UI). */
export function normalizeKycRejectReason(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > KYC_REJECT_REASON_MAX) return null;
  return trimmed;
}

/** Body untuk POST /api/kyc/:id/reject — reason di-trim sebelum dikirim. */
export function buildKycRejectBody(raw: string): { reason: string } {
  return { reason: normalizeKycRejectReason(raw) ?? "" };
}

/** Pesan confirm danger yang meng-echo alasan persis sebelum aksi irreversible. */
export function kycRejectConfirmMessage(reason: string): string {
  return `Alasan yang akan dicatat: "${reason}"`;
}
