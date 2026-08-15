import { mapUserRow, readDb } from "../reads.js";
import type { User } from "../store.js";

// Domain reads: users public-safe fields (docs/13 Wave 1).

export async function getUserById(id: string): Promise<User | null> {
  const db = readDb();
  const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUserRow(data as Record<string, unknown>) : null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = readDb();
  const { data, error } = await db.from("users").select("*").ilike("username", username).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapUserRow(data as Record<string, unknown>) : null;
}

export async function listUsersByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  const db = readDb();
  const { data, error } = await db.from("users").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapUserRow(r as Record<string, unknown>));
}
