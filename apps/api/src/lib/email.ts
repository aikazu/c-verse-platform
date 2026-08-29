// Creator access email (admin provisioning, docs/10 §3.6 — FINAL 2026-08-20).
// Transport (owner decision 2026-08-29): Cloudflare Email Service via the Workers
// `send_email` binding (`env.EMAIL`, rich message form) — SMTP/nodemailer dropped
// entirely (nodemailer is Node-only and breaks on Workers).
// Flag `EMAIL_ENABLED` default OFF in dev: without the flag the module never
// touches a transport — it logs an info line and returns { sent: false }.
// When enabled but the binding is absent (local Node dev via tsx), the message
// metadata is logged (recipient redacted, M2; bodies omitted) instead of sent.
// Send failures are caught and mapped to a reason code — nothing ever throws
// into the route.

export interface CreatorAccessEmailInput {
  to: string;
  displayName: string;
}

export interface EmailSendResult {
  sent: boolean;
  reason?: string;
}

/** Rich message form of the Email Service Workers API (canonical contract). */
export interface SendEmailMessage {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  text: string;
  html: string;
}

/** Minimal structural type of the Workers `send_email` binding (name: EMAIL). */
export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<unknown>;
}

/** Env slice needed for sending — mirrored by `Bindings` in src/index.ts. */
export interface EmailBindings {
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const EMAIL_FROM_NAME = "C.Verse";

function getEnv(name: string): string | undefined {
  // Wrangler / Workers: `globalThis` may have env injected; also check process.env for Node
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Template email akses — Bahasa Indonesia, login passwordless (tanpa password). */
export function creatorAccessEmailTemplate(input: CreatorAccessEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
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
  const displayName = escapeHtml(input.displayName);
  const to = escapeHtml(input.to);
  const html = [
    `<p>Halo ${displayName},</p>`,
    "<p>Akun Kreator C.Verse kamu sudah aktif dan siap dipakai.</p>",
    "<p>Cara login (tanpa password):</p>",
    "<ol>",
    `<li>Buka <a href="https://c-verse.co">https://c-verse.co</a></li>`,
    `<li>Pilih login lewat email — masukkan alamat email ini: <strong>${to}</strong></li>`,
    "<li>Masukkan kode OTP 6 digit yang dikirim ke email kamu (atau login lewat Google dengan email yang sama).</li>",
    "</ol>",
    "<p><strong>Penting:</strong> platform ini tidak memakai password sama sekali. Jangan pernah memasukkan password di mana pun.</p>",
    "<p>Selamat berkarya!<br>— Tim C.Verse</p>",
  ].join("\n");
  return { subject, text, html };
}

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

function resolveBinding(env?: EmailBindings): SendEmailBinding | undefined {
  if (env?.EMAIL) return env.EMAIL;
  // Same env-probe idiom as getEnv: some runtimes expose bindings on globalThis;
  // in plain Node dev it is simply absent -> "email_binding_unavailable".
  const g = globalThis as unknown as { EMAIL?: SendEmailBinding };
  return g.EMAIL;
}

function resolveEmailFrom(env?: EmailBindings): string | undefined {
  return env?.EMAIL_FROM ?? getEnv("EMAIL_FROM");
}

function extractSendErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "email_send_failed";
}

/**
 * Low-level send via the Cloudflare Email Service binding. Resolution order:
 * 1. EMAIL_ENABLED off -> { sent:false, reason:"email_disabled" } (no transport touched);
 * 2. enabled + EMAIL_FROM missing -> { sent:false, reason:"email_from_missing" };
 * 3. enabled + binding present -> binding.send(...) with both text and html;
 * 4. enabled + binding absent (local Node dev) -> payload logged (redacted), no send;
 * 5. send throws -> raw error logged server-side, mapped reason — never rethrown.
 */
export async function sendEmail(input: EmailSendInput, env?: EmailBindings): Promise<EmailSendResult> {
  if (getEnv("EMAIL_ENABLED") !== "true") {
    console.info(`[email] kirim ke ${redactEmail(input.to)} di-skip (EMAIL_ENABLED nonaktif)`);
    return { sent: false, reason: "email_disabled" };
  }
  const from = resolveEmailFrom(env);
  if (!from) return { sent: false, reason: "email_from_missing" };
  const binding = resolveBinding(env);
  if (!binding) {
    // Log metadata only — the creator template embeds the raw recipient address
    // in text/html, so logging the full payload would defeat the `to` redaction.
    const payload = JSON.stringify({
      to: redactEmail(input.to),
      from: { email: from, name: EMAIL_FROM_NAME },
      subject: input.subject,
    });
    console.info(`[email] send_email binding tidak tersedia di runtime ini — payload (tujuan di-redact): ${payload}`);
    return { sent: false, reason: "email_binding_unavailable" };
  }
  try {
    await binding.send({
      to: input.to,
      from: { email: from, name: EMAIL_FROM_NAME },
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { sent: true };
  } catch (err) {
    console.error("[email] gagal kirim:", err);
    return { sent: false, reason: extractSendErrorCode(err) };
  }
}

/** Kirim email akses kreator — flag EMAIL_ENABLED default OFF (dev). */
export async function sendCreatorAccessEmail(input: CreatorAccessEmailInput, env?: EmailBindings): Promise<EmailSendResult> {
  const { subject, text, html } = creatorAccessEmailTemplate(input);
  return sendEmail({ to: input.to, subject, text, html }, env);
}
