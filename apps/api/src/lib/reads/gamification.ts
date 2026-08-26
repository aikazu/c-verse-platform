import type { LeaderboardType } from "@c-verse/shared";
import { mapBadgeRow, mapUserBadgeRow, readDb } from "../reads.js";
import type { BadgeDef, UserBadge } from "../store.js";

// Domain reads: gamification (leaderboard + badges) — read-only SELECT (docs/13 §3 Wave 2).

// Row shape returned by public.get_leaderboard RPC (supabase/migrations/04_rpc.sql).
// Kept local so the mapper does not leak SQL column names into the rest of the app.
interface LeaderboardRpcRow {
  rank: number | bigint;
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  total_xp: number;
  score: number | bigint;
  reached_at: string;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  totalXp: number;
  score: number;
  reachedAt: string;
}

// Multi-type leaderboard selector (docs/15). Privacy (is_anonymous=false AND
// flag_reason IS NULL) is enforced inside the SQL function — the route never
// re-filters client-side. Pass creatorId=null for global boards.
export async function listLeaderboard(type: LeaderboardType, creatorId: string | null, limit: number): Promise<LeaderboardRow[]> {
  const db = readDb();
  const { data, error } = await db.rpc("get_leaderboard", {
    p_type: type,
    p_creator_id: creatorId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return ((data as LeaderboardRpcRow[] | null) ?? []).map((r) => ({
    rank: Number(r.rank ?? 0),
    userId: String(r.user_id ?? ""),
    displayName: String(r.display_name ?? ""),
    username: (r.username as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    totalXp: Number(r.total_xp ?? 0),
    score: Number(r.score ?? 0),
    reachedAt: String(r.reached_at ?? ""),
  }));
}

export async function listBadges(): Promise<BadgeDef[]> {
  const db = readDb();
  const { data, error } = await db.from("badges").select("*").order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapBadgeRow(r as Record<string, unknown>));
}

export async function listUserBadges(userId: string): Promise<(UserBadge & { badge: BadgeDef | undefined })[]> {
  const badges = await listBadges();
  const badgeById = new Map<string, BadgeDef>(badges.map((b) => [b.id, b]));
  const db = readDb();
  const { data, error } = await db.from("user_badges").select("*").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const ub = mapUserBadgeRow(r as Record<string, unknown>);
    return { ...ub, badge: badgeById.get(ub.badgeId) };
  });
}
