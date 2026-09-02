// Worker drain queue email transaksional (2026-09-02).
// Trigger SQL menulis baris channel='email' status='pending' via notify_user;
// pekerjaan cron (CRON_EVERY_MINUTE, lib/cron.ts) memanen batch kecil ini dan
// mengirim via lib/email.ts. Kontrak:
//   - EMAIL_ENABLED !== 'true' -> antrian tidak disentuh sama sekali (dev OFF).
//   - template_key tanpa render / tanpa alamat email -> dicoba sampai cap
//     attempts (MAX_ATTEMPTS) lalu 'failed' (kegagalan permanen).
//   - email_disabled / email_binding_unavailable -> infrastruktur sementara:
//     batch berhenti, baris tetap 'pending' tanpa penalti attempts.
//   - kegagalan kirim lainnya (transport error) -> attempts+1; cap 3 -> 'failed'.
// Batch kecil (QUEUE_BATCH) + event 1:1 per uang/pemenuhan = lane low volume.

import { type EmailSendInput, sendEmail } from "./email.js";
import { renderNotificationEmail } from "./emailTemplates.js";
import { getSupabase } from "./supabase.js";

const QUEUE_BATCH = 50;
const MAX_ATTEMPTS = 3;
/** Kegagalan infrastruktur sementara — jangan hukum attempts, tunggu tick berikutnya. */
const STOP_REASONS = new Set(["email_disabled", "email_binding_unavailable"]);

export interface EmailQueueRow {
  id: string;
  template_key: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  users: { email: string } | null;
}

export interface DrainResult {
  disabled: boolean;
  sent: number;
  failed: number;
  retried: number;
  stopped: boolean;
}

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

async function listPendingQueue(env?: Record<string, string | undefined>): Promise<EmailQueueRow[]> {
  const db = getSupabase(env);
  const { data, error } = await db
    .from("notifications")
    .select("id, template_key, payload, attempts, users(email)")
    .eq("channel", "email")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(QUEUE_BATCH);
  if (error) throw new Error(`email queue list failed: ${error.message}`);
  return (data ?? []) as unknown as EmailQueueRow[];
}

async function markSent(id: string): Promise<void> {
  const { error } = await getSupabase().from("notifications").update({ status: "sent" }).eq("id", id);
  if (error) throw new Error(`email queue mark sent failed: ${error.message}`);
}

/** attempts+1; mencapai MAX_ATTEMPTS -> 'failed' (permanen), selain itu tetap 'pending'. */
async function markAttempt(row: EmailQueueRow): Promise<"pending" | "failed"> {
  const attempts = row.attempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  const { error } = await getSupabase().from("notifications").update({ attempts, status }).eq("id", row.id);
  if (error) throw new Error(`email queue mark attempt failed: ${error.message}`);
  return status;
}

/**
 * Panen antrian email transaksional. Never throws into the cron lane for
 * per-row issues — hanya kegagalan DB/list yang propagate (ditangani lane
 * cron sebagai job failure -> digest admin).
 */
export async function drainEmailQueue(env?: Record<string, string | undefined>): Promise<DrainResult> {
  const disabled = getEnv("EMAIL_ENABLED") !== "true";
  const result: DrainResult = { disabled, sent: 0, failed: 0, retried: 0, stopped: false };
  if (disabled) return result;

  const rows = await listPendingQueue(env);
  for (const row of rows) {
    const rendered = renderNotificationEmail(row.template_key, row.payload);
    const to = row.users?.email;
    if (!rendered || !to) {
      // Permanent by construction (template hilang / user tanpa email) —
      // biarkan cap attempts yang memutus, supaya satu jalur akuntansi.
      if ((await markAttempt(row)) === "failed") result.failed += 1;
      else result.retried += 1;
      continue;
    }
    const input: EmailSendInput = { to, subject: rendered.subject, text: rendered.text, html: rendered.html };
    const outcome = await sendEmail(input);
    if (outcome.sent) {
      await markSent(row.id);
      result.sent += 1;
      continue;
    }
    if (outcome.reason && STOP_REASONS.has(outcome.reason)) {
      // Transport sementara tidak siap — hentikan batch, tanpa penalti.
      result.stopped = true;
      break;
    }
    if ((await markAttempt(row)) === "failed") result.failed += 1;
    else result.retried += 1;
  }
  return result;
}
