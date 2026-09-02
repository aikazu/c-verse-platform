import { mapWalletRow, mapWalletTxRow, readDb } from "../../lib/reads.js";
import type { Wallet, WalletGems, WalletTx } from "../../lib/store.js";

// Domain reads: wallets, gem_lots & wallet_transactions (docs/13 §3 Wave 2 —
// read-only SELECT). Money writes stay in Midtrans webhook / RPC (lib/db.ts) —
// this module never mutates.

function defaultWallet(userId: string): Wallet {
  return { userId, balanceCCoin: 0, balanceGems: 0, totalTopupCCoin: 0, totalSpentCCoin: 0, holdPayoutUntil: null };
}

export async function getWallet(userId: string): Promise<WalletGems> {
  const db = readDb();
  // Dual-token (docs/07): saldo Gems live di wallets.balance_gems; kesiapan cair
  // dihitung dari gem_lots (lot dengan mature_at <= now() = sudah matured).
  // supabase-js has no FILTER aggregate — sum in JS over the user's own lots.
  const [walletRes, lotsRes] = await Promise.all([
    db.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
    db.from("gem_lots").select("remaining, mature_at").eq("user_id", userId),
  ]);
  if (walletRes.error) throw new Error(walletRes.error.message);
  if (lotsRes.error) throw new Error(lotsRes.error.message);
  const base: Wallet = walletRes.data ? mapWalletRow(walletRes.data as Record<string, unknown>) : defaultWallet(userId);
  const nowMs = Date.now();
  const gemsMatured = ((lotsRes.data ?? []) as Array<Record<string, unknown>>).reduce(
    (sum, lot) => (lot.mature_at == null || new Date(String(lot.mature_at)).getTime() <= nowMs ? sum + Number(lot.remaining ?? 0) : sum),
    0,
  );
  return { ...base, gemsMatured, gemsLocked: base.balanceGems - gemsMatured };
}

export async function listWalletTxs(userId: string, limit = 100): Promise<WalletTx[]> {
  const db = readDb();
  const { data, error } = await db
    .from("wallet_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapWalletTxRow(r as Record<string, unknown>));
}

export async function isPayoutHeld(userId: string): Promise<{ held: boolean; until: string | null }> {
  // held only while hold date is in the future
  const w = await getWallet(userId);
  if (!w.holdPayoutUntil) return { held: false, until: null };
  const until = new Date(w.holdPayoutUntil).getTime();
  if (Date.now() < until) return { held: true, until: w.holdPayoutUntil };
  return { held: false, until: null };
}
