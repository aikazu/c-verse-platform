import type { EditorialKind, EditorialState, PublishedEditorial } from "@c-verse/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDb } from "../reads.js";

export async function getEditorialDraft(
  db: SupabaseClient,
  dropId: string,
  kind: EditorialKind,
): Promise<Omit<EditorialState, "cards"> | null> {
  const { data, error } = await db
    .from("drop_editorial")
    .select("draft,published,revision")
    .eq("drop_id", dropId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new Error("Gagal memuat draft konten");
  return data;
}
export async function getPublicEditorial(dropId: string): Promise<PublishedEditorial[]> {
  const { data, error } = await readDb().rpc("get_public_drop_editorial", { p_drop_id: dropId });
  if (error) throw new Error("Gagal memuat konten");
  return data ?? [];
}
