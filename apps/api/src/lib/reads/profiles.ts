import { mapBadgeRow, mapUserBadgeRow, mapUserRow, type Row, readDb } from "../reads.js";
import type { BadgeDef, User, UserBadge } from "../store.js";

// Domain reads: public profile (docs 02 PG-PROFILE-01 + gamification badges).

// users.id is uuid — eq() with an arbitrary string (username/handle) would fail with 22P02, so guard id lookups
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getUserByUsernameOrId(raw: string): Promise<User | null> {
  const db = readDb();
  const byName = await db.from("users").select("*").ilike("username", raw).maybeSingle();
  if (byName.error) throw new Error(byName.error.message);
  if (byName.data) return mapUserRow(byName.data as Row);
  if (!UUID_RE.test(raw)) return null;
  const { data, error } = await db.from("users").select("*").eq("id", raw).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUserRow(data as Row) : null;
}

export async function listBadgeDefs(ids: string[]): Promise<BadgeDef[]> {
  if (ids.length === 0) return [];
  const db = readDb();
  const { data, error } = await db.from("badges").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapBadgeRow(r as Row));
}

export interface UserBadgeWithDef extends UserBadge {
  badge?: BadgeDef;
}

export async function listUserBadges(userId: string): Promise<UserBadgeWithDef[]> {
  const db = readDb();
  const { data, error } = await db.from("user_badges").select("*").eq("user_id", userId).order("earned_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const badgeIds = [...new Set(rows.map((r) => String(r.badge_id ?? "")))].filter((id) => id !== "");
  const defById = new Map<string, BadgeDef>((await listBadgeDefs(badgeIds)).map((b) => [b.id, b]));
  return rows.map((r) => {
    const ub = mapUserBadgeRow(r);
    return { ...ub, badge: defById.get(ub.badgeId) };
  });
}

/** Rank = number of users with strictly higher XP, +1. */
export async function getUserRank(userId: string, xp: number): Promise<number> {
  const db = readDb();
  const { count, error } = await db.from("users").select("id", { count: "exact", head: true }).gt("total_xp", xp);
  if (error) throw new Error(error.message);
  return (count ?? 0) + 1;
}
