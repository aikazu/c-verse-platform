import type { PublicShowcase, ShowcaseInput } from "@c-verse/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDb } from "../reads.js";

export async function getMyShowcase(db: SupabaseClient, userId: string): Promise<ShowcaseInput> {
  const { data, error } = await db.from("collection_showcases").select("title,card_ids").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Gagal memuat etalase");
  return { title: data?.title ?? "", cardIds: data?.card_ids ?? [] };
}

export async function getPublicShowcase(username: string): Promise<PublicShowcase | null> {
  const { data, error } = await readDb().rpc("get_public_showcase", { p_username: username });
  if (error) throw new Error("Gagal memuat etalase publik");
  return data;
}
