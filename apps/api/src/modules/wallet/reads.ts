import { mapWalletRow, mapWalletTxRow, readDb } from "../../lib/reads.js";
import type { Wallet, WalletTx } from "../../lib/store.js";

// Domain reads: wallets & wallet_transactions (docs/13 §3 Wave 2 — read-only SELECT).
// Money writes stay in Midtrans webhook / RPC (lib/db.ts) — this module never mutates.

function defaultWallet(userId: string): Wallet {
  return { userId, balanceCCoin: 0, totalTopupCCoin: 0, totalSpentCCoin: 0, holdPayoutUntil: null };
}

export async function getWallet(userId: string): Promise<Wallet> {
  const db = readDb();
  const { data, error } = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWalletRow(data as Record<string, unknown>) : defaultWallet(userId);
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
