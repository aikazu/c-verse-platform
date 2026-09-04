// PII redaction helpers — see apps/api/src/lib/redact.test.ts for the matrix.
// M5 (audit 2026-08-24): NIK (Indonesian national ID, 16 digits) and the user's own
// KYC address are returned by /api/kyc and /api/kyc submissions. The caller already
// knows their own data; echoing the full PII over the wire is unnecessary and the
// admin endpoint (/api/kyc/admin/all) keeps the unredacted identity fields so
// reviewers can verify them. R2 object keys never leave the server.

/** Mask all but the last 4 characters of a NIK. Returns the input unchanged if it
 *  does not look like a 16-digit number — redaction must never crash callers. */
export function redactNik(nik: string): string {
  if (!/^\d{16}$/.test(nik)) return nik;
  return `${"*".repeat(12)}${nik.slice(-4)}`;
}

export interface RedactableKyc {
  fullName: string;
  nik: string;
  address: string;
  ktpObjectKey?: string | null;
  npwpObjectKey?: string | null;
  selfieObjectKey?: string | null;
}

/** Redact PII for the user-facing KYC endpoints. Keeps status/timestamps/ids. */
export function redactKycForOwner<T extends RedactableKyc>(
  rec: T,
): Omit<T, "nik" | "address" | "ktpObjectKey" | "npwpObjectKey" | "selfieObjectKey"> & { nik: string; address: string } {
  const { nik, address: _address, ktpObjectKey: _ktp, npwpObjectKey: _npwp, selfieObjectKey: _selfie, ...safe } = rec;
  return { ...safe, nik: redactNik(nik), address: "[redacted]" };
}
