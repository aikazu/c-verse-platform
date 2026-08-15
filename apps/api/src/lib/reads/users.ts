import { mapUserRow, readDb, seedOnce } from "../reads.js";
import type { User } from "../store.js";
import { store } from "../store.js";

// Domain reads: users public-safe fields (docs/13 Wave 1).

export async function getUserById(id: string): Promise<User | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.users.get(id) ?? null;
  }
  const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUserRow(data as Record<string, unknown>) : null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.users.values()].find((u) => (u.username ?? "").toLowerCase() === username.toLowerCase()) ?? null;
  }
  const { data, error } = await db.from("users").select("*").ilike("username", username).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUserRow(data as Record<string, unknown>) : null;
}

export async function listUsersByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  const db = readDb();
  if (!db) {
    seedOnce();
    return ids.map((id) => store.users.get(id)).filter((u): u is User => u != null);
  }
  const { data, error } = await db.from("users").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapUserRow(r as Record<string, unknown>));
}
