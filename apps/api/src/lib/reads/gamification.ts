import { mapBadgeRow, mapUserBadgeRow, mapUserRow, readDb } from "../reads.js";
import type { BadgeDef, User, UserBadge } from "../store.js";

// Domain reads: gamification (leaderboard + badges) — read-only SELECT (docs/13 §3 Wave 2).

export async function listTopUsersByXp(limit: number): Promise<User[]> {
  const db = readDb();
  // leaderboard cuma butuh identitas + XP — jangan tarik email/consent/flag kolom lain
  const { data, error } = await db
    .from("users")
    .select("id, display_name, username, role, total_xp, level, is_anonymous")
    .order("total_xp", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapUserRow(r as Record<string, unknown>));
}

export async function countCardsByOwner(userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;
  const db = readDb();
  const { data, error } = await db.from("cards").select("owner_id").in("owner_id", userIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const ownerId = (row as Record<string, unknown>).owner_id;
    if (typeof ownerId === "string") counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
  }
  return counts;
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
