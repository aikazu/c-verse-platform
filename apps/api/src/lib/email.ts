// Email akses akun kreator (admin-provisioned, docs/10 §3.6 — FINAL 2026-08-20).
// Flag `EMAIL_ENABLED` default OFF di dev: tanpa flag, modul tidak pernah
// menyentuh SMTP — hanya mencatat info dan return { sent: false }.
// Saat diaktifkan, kirim via SumoPod SMTP (smtp.sumopod.com:465, SSL) memakai
// nodemailer bila tersedia di runtime; kalau transport tidak tersedia, lempar
// error yang jelas (jalur ini TIDAK dieksekusi di test/dev karena flag OFF).

export interface CreatorAccessEmailInput {
  to: string;
  displayName: string;
}

export interface EmailSendResult {
  sent: boolean;
  reason?: string;
}

function getEnv(name: string): string | undefined {
  // Wrangler / Workers: `globalThis` may have env injected; also check process.env for Node
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

/** Template email akses — Bahasa Indonesia, login passwordless (tanpa password). */
export function creatorAccessEmailTemplate(input: CreatorAccessEmailInput): { subject: string; text: string } {
  const subject = "Akun Kreator C.Verse kamu sudah aktif";
  const text = [
    `Halo ${input.displayName},`,
    "",
    "Akun Kreator C.Verse kamu sudah aktif dan siap dipakai.",
    "",
    "Cara login (tanpa password):",
    "1. Buka https://c-verse.co",
    "2. Pilih login lewat email — masukkan alamat email ini:",
    `   ${input.to}`,
    "3. Masukkan kode OTP 6 digit yang dikirim ke email kamu (atau login lewat Google dengan email yang sama).",
    "",
    "Penting: platform ini tidak memakai password sama sekali. Jangan pernah memasukkan password di mana pun.",
    "",
    "Selamat berkarya!",
    "— Tim C.Verse",
  ].join("\n");
  return { subject, text };
}

type NodeMailerTransportLike = { sendMail: (opts: Record<string, string>) => Promise<unknown> };

/**
 * Mask an email address for log output (M2). Keeps the first character and the
 * domain so operators can still correlate lines without leaking the full PII
 * address. Returns the input unchanged when it does not look like an email —
 * log redaction must never crash the caller.
 */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `**@${domain}`;
  return `${local[0]}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

type NodeMailerModule = {
  default?: {
    createTransport: (opts: Record<string, unknown>) => NodeMailerTransportLike;
  };
};

/**
 * Kirim via SumoPod SMTP memakai nodemailer jika tersedia di runtime.
 * Tanpa nodemailer di runtime ini SMTP belum bisa dikirim — error eksplisit,
 * bukan silent fail (modul TIDAK menambah dependency baru).
 */
async function sendViaSmtp(input: CreatorAccessEmailInput): Promise<void> {
  // Dynamic import dengan specifier non-literal: nodemailer bukan dependency —
  // kalau runtime tidak punya paketnya, import gagal dan kita lempar error jelas.
  const modId = "nodemailer";
  const nodemailer = (await import(modId).catch(() => null)) as NodeMailerModule | null;
  if (!nodemailer?.default?.createTransport) {
    throw new Error("SMTP transport belum tersedia di runtime ini (nodemailer tidak terinstall)");
  }
  const host = getEnv("SMTP_HOST") ?? "smtp.sumopod.com";
  const port = Number(getEnv("SMTP_PORT") ?? "465");
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const transport: NodeMailerTransportLike = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  const { subject, text } = creatorAccessEmailTemplate(input);
  await transport.sendMail({ from: user ? `C.Verse <${user}>` : "C.Verse <no-reply@c-verse.co>", to: input.to, subject, text });
}

/** Kirim email akses kreator — flag EMAIL_ENABLED default OFF (dev). */
export async function sendCreatorAccessEmail(input: CreatorAccessEmailInput): Promise<EmailSendResult> {
  if (getEnv("EMAIL_ENABLED") !== "true") {
    // M2 (audit 2026-08-24): redact the destination address in logs — the local-part
    // is PII. Domain is kept for ops correlation.
    console.info(`[email] akses kreator ke ${redactEmail(input.to)} di-skip (EMAIL_ENABLED nonaktif)`);
    return { sent: false, reason: "disabled" };
  }
  try {
    await sendViaSmtp(input);
    return { sent: true };
  } catch (err) {
    console.error("[email] gagal kirim akses kreator:", err instanceof Error ? err.message : String(err));
    return { sent: false, reason: "error" };
  }
}
