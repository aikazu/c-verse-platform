import { mapBadgeRow, mapKycRow, mapUserBadgeRow, mapWalletRow, type Row, readDb, seedOnce } from "../reads.js";
import type { BadgeDef, KycRecord, UserBadge, Wallet } from "../store.js";
import { ensureWallet, store } from "../store.js";

// Domain reads: profile aggregation (docs/13 §3 Wave 3 — public select, no RPC needed).

export async function getWalletByUser(userId: string): Promise<Wallet> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return ensureWallet(userId);
  }
  const { data, error } = await db.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  // No wallet row yet -> zero-balance view (rows are created lazily by wallet RPCs).
  return data ? mapWalletRow(data as Row) : { userId, balanceCCoin: 0, totalTopupCCoin: 0, totalSpentCCoin: 0, holdPayoutUntil: null };
}

export interface UserBadgeWithDef extends UserBadge {
  badge?: BadgeDef;
}

export async function listUserBadges(userId: string): Promise<UserBadgeWithDef[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.userBadges
      .filter((ub) => ub.userId === userId)
      .map((ub) => ({ ...ub, badge: store.badges.find((b) => b.id === ub.badgeId) }));
  }
  const { data: ubRows, error: ubError } = await db.from("user_badges").select("*").eq("user_id", userId);
  if (ubError) throw new Error(ubError.message);
  const earned = (ubRows ?? []).map((r) => mapUserBadgeRow(r as Row));
  const badgeIds = [...new Set(earned.map((ub) => ub.badgeId))];
  const defById = new Map<string, BadgeDef>();
  if (badgeIds.length > 0) {
    const { data: badgeRows, error: badgeError } = await db.from("badges").select("*").in("id", badgeIds);
    if (badgeError) throw new Error(badgeError.message);
    for (const r of badgeRows ?? []) {
      const def = mapBadgeRow(r as Row);
      defById.set(def.id, def);
    }
  }
  return earned.map((ub) => ({ ...ub, badge: defById.get(ub.badgeId) }));
}

export async function getKycByUser(userId: string): Promise<KycRecord | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.kyc.values()].find((k) => k.userId === userId) ?? null;
  }
  const { data, error } = await db.from("kyc_records").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapKycRow(data as Row) : null;
}
