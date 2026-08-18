export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Terjadi kesalahan";
}

/** Mask an Indonesian NIK (16 digits) to the last 4 — minimise PII exposure in admin UI (UU PDP). */
export function maskNik(nik: string | null | undefined): string {
  if (!nik) return "—";
  const last4 = nik.slice(-4);
  return `•••• •••• •••• ${last4}`;
}
