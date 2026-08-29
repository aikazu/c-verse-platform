import path from "node:path";

/**
 * Fixture upload KYC: PNG 1x1 transparan (70 byte) — Kyc.tsx hanya butuh File
 * yang lolos accept image/* (isi piksel tidak diverifikasi; UI menampilkan
 * nama + ukuran). File PNG trivial, bukan aset binary besar.
 */
export const KYC_KTP_FIXTURE = path.join(__dirname, "kyc-ktp.png");
export const KYC_SELFIE_FIXTURE = path.join(__dirname, "kyc-selfie.png");
