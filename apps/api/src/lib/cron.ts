import { getSupabase } from "./supabase.js";

// Cron handlers (docs/08 §3.3) — logika bisnis ada di SQL security-definer,
// Workers hanya trigger. Badge & housekeeping tanpa cron: event-driven (docs/06).

export const CRON_EVERY_5_MIN = "*/5 * * * *"; // scheduled drops activation + raffle draw
export const CRON_PAYOUT_BATCH = "0 23 * * 1"; // Tue 06:00 WIB = Mon 23:00 UTC

type EnvLike = Record<string, string | undefined>;

async function rpcOrNull(env: EnvLike, fn: string, args?: Record<string, unknown>): Promise<number | string | null> {
  const db = getSupabase(env); // fail-fast: tanpa DB cron ikut mati keras
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) {
    console.error(`[cron] ${fn} failed:`, error.message);
    return null;
  }
  return data as number | string | null;
}

export async function runCron(cron: string, env: EnvLike): Promise<void> {
  if (cron === CRON_EVERY_5_MIN) {
    // Founder 2026-08-28: escrow_auto_release dihapus — semua pembelian settle
    // langsung ke vault; shipping pasca-vault tidak pakai escrow.
    const activated = await rpcOrNull(env, "activate_scheduled_drops");
    const drawn = await rpcOrNull(env, "draw_pending_drops");
    console.log(`[cron] activate_scheduled_drops=${activated ?? "skip"} draw_pending_drops=${drawn ?? "skip"}`);
    return;
  }
  if (cron === CRON_PAYOUT_BATCH) {
    const batchId = await rpcOrNull(env, "payout_batch_run");
    console.log(`[cron] payout_batch_run=${batchId ?? "no eligible payouts"}`);
    return;
  }
  console.warn(`[cron] no handler for "${cron}"`);
}
