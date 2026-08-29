import { mapCardRow, mapOwnershipRow, readDb } from "../../lib/reads.js";
import type { Card, OwnershipHistory } from "../../lib/store.js";

// Domain reads: NFC card lookup & ownership history (docs/13 §3 Wave 5).
// Card writes (verify_status / last_ctr) stay in modules/nfc/routes.ts persistVerification.

export async function getCardByNfcUid(nfcUid: string): Promise<Card | null> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").ilike("nfc_uid", nfcUid).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}

export async function getCardByNfcShortId(shortId: string): Promise<Card | null> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").eq("nfc_short_id", shortId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}

export async function listOwnershipByCard(cardId: string): Promise<OwnershipHistory[]> {
  const db = readDb();
  const { data, error } = await db
    .from("ownership_history")
    .select("*")
    .eq("card_id", cardId)
    .order("transferred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapOwnershipRow(r as Record<string, unknown>));
}
