import { type EmailBindings, type SendEmailBinding, sendEmail } from "./email.js";
import { drainEmailQueue } from "./emailQueue.js";
import { getSupabase } from "./supabase.js";

// Cron handlers (docs/08 §3.3) — logika bisnis ada di SQL security-definer,
// Workers hanya trigger. Badge & housekeeping tanpa cron: event-driven (docs/06).

export const CRON_EVERY_MINUTE = "* * * * *"; // drain queue email transaksional (lib/emailQueue.ts)
export const CRON_EVERY_5_MIN = "*/5 * * * *"; // scheduled drops activation + raffle draw
export const CRON_PAYOUT_BATCH = "0 23 * * 1"; // Tue 06:00 WIB = Mon 23:00 UTC

type EnvLike = Record<string, string | undefined>;

/** One failed job within a cron run — server-side detail only, never user-facing. */
interface CronJobFailure {
  job: string;
  message: string;
}

const MAX_ALERT_MESSAGE_LENGTH = 300;

async function rpcOrNull(
  env: EnvLike,
  failures: CronJobFailure[],
  fn: string,
  args?: Record<string, unknown>,
): Promise<number | string | null> {
  const db = getSupabase(env); // fail-fast: tanpa DB cron ikut mati keras
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) {
    // Dev path: per-job log stays; the admin digest email is additive (audit fix).
    console.error(`[cron] ${fn} failed:`, error.message);
    failures.push({ job: fn, message: error.message });
    return null;
  }
  return data as number | string | null;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function truncated(message: string): string {
  return message.length > MAX_ALERT_MESSAGE_LENGTH ? `${message.slice(0, MAX_ALERT_MESSAGE_LENGTH)}…` : message;
}

/** Plain text + minimal html summary — job names and error codes/messages only. */
function buildFailureAlertEmail(failures: CronJobFailure[]): { subject: string; text: string; html: string } {
  const subject = `[C.Verse] cron failures — ${failures.length} job(s) failed`;
  const lines = failures.map((failure) => `- ${failure.job}: ${truncated(failure.message)}`);
  const text = ["Scheduled jobs failed in the last cron run:", "", ...lines].join("\n");
  const items = failures.map(
    (failure) => `<li><strong>${escapeHtml(failure.job)}</strong>: ${escapeHtml(truncated(failure.message))}</li>`,
  );
  const html = [`<p>Scheduled jobs failed in the last cron run:</p>`, "<ul>", ...items, "</ul>"].join("\n");
  return { subject, text, html };
}

function isSendEmailBinding(value: unknown): value is SendEmailBinding {
  return typeof value === "object" && value !== null && typeof (value as { send?: unknown }).send === "function";
}

/** Narrow the loose cron env into the slice sendEmail needs (EMAIL binding + sender). */
function emailBindingsOf(env: EnvLike): EmailBindings {
  const email = (env as { EMAIL?: unknown }).EMAIL;
  return { EMAIL: isSendEmailBinding(email) ? email : undefined, EMAIL_FROM: env.EMAIL_FROM };
}

/**
 * One digest email per cron run when anything failed. Never throws and never
 * changes the run outcome — runCron already sits inside the handler's
 * `ctx.waitUntil`, so awaiting here keeps the send attached to the request
 * lifetime (per job fire-and-forget semantics are untouched).
 */
async function sendFailureAlert(env: EnvLike, failures: CronJobFailure[]): Promise<void> {
  const to = env.ADMIN_ALERT_EMAIL;
  if (!to) {
    console.warn("[cron] ADMIN_ALERT_EMAIL unset — failure digest not sent");
    return;
  }
  try {
    const { subject, text, html } = buildFailureAlertEmail(failures);
    const result = await sendEmail({ to, subject, text, html }, emailBindingsOf(env));
    if (!result.sent) console.warn(`[cron] failure digest not delivered: ${result.reason ?? "unknown reason"}`);
  } catch (err) {
    console.error("[cron] failure digest send failed:", err);
  }
}

export async function runCron(cron: string, env: EnvLike): Promise<void> {
  const failures: CronJobFailure[] = [];
  if (cron === CRON_EVERY_MINUTE) {
    // Queue email transaksional (trigger SQL -> lib/emailQueue.ts). EMAIL_ENABLED
    // off = no-op tanpa sentuh DB (dev). Kegagalan infrastruktur masuk digest
    // seperti job lain.
    try {
      const result = await drainEmailQueue(env);
      if (!result.disabled) {
        console.log(
          `[cron] email_queue_drain sent=${result.sent} retried=${result.retried} failed=${result.failed}${result.stopped ? " stopped=1" : ""}`,
        );
      }
    } catch (err) {
      console.error("[cron] email_queue_drain failed:", err instanceof Error ? err.message : err);
      failures.push({ job: "email_queue_drain", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (cron === CRON_EVERY_5_MIN) {
    // Founder 2026-08-28: escrow_auto_release dihapus — semua pembelian settle
    // langsung ke vault; shipping pasca-vault tidak pakai escrow.
    const activated = await rpcOrNull(env, failures, "activate_scheduled_drops");
    const drawn = await rpcOrNull(env, failures, "draw_pending_drops");
    console.log(`[cron] activate_scheduled_drops=${activated ?? "skip"} draw_pending_drops=${drawn ?? "skip"}`);
  } else if (cron === CRON_PAYOUT_BATCH) {
    const batchId = await rpcOrNull(env, failures, "payout_batch_run");
    console.log(`[cron] payout_batch_run=${batchId ?? "no eligible payouts"}`);
  } else {
    console.warn(`[cron] no handler for "${cron}"`);
    return;
  }
  if (failures.length > 0) await sendFailureAlert(env, failures);
}
