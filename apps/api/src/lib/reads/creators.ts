import { mapCreatorRow, mapUserRow, type Row, readDb } from "../reads.js";
import type { CreatorRec, User } from "../store.js";

// Domain reads: creator records and public creator users.

export async function listCreators(): Promise<CreatorRec[]> {
  const db = readDb();
  const { data, error } = await db.from("creators").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCreatorRow(r as Row));
}

export async function getCreatorByHandle(handle: string): Promise<CreatorRec | null> {
  const db = readDb();
  const { data, error } = await db.from("creators").select("*").ilike("handle", handle).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCreatorRow(data as Row) : null;
}

export async function getCreatorByUserId(userId: string): Promise<CreatorRec | null> {
  const db = readDb();
  const { data, error } = await db.from("creators").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCreatorRow(data as Row) : null;
}

/** Users carrying role=creator (creator listing/SEO derive from users, creators table only adds handle/followers).
 * Privacy: hide suspended (flag_reason) + anonymous creators — konsisten dengan profile/creator store
 * yang menyembunyikan user suspended dari permukaan publik. Filter di SQL.
 */
export async function listCreatorUsers(): Promise<User[]> {
  const db = readDb();
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("role", "creator")
    .eq("is_anonymous", false)
    .is("flag_reason", null)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapUserRow(r as Row));
}
