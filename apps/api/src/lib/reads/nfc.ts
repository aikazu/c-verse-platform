import { mapCardRow, mapOwnershipRow, readDb, seedOnce } from "../reads.js";
import type { Card, OwnershipHistory } from "../store.js";
import { store } from "../store.js";

// Domain reads: NFC card lookup & ownership history (docs/13 §3 Wave 5).
// Card writes (verify_status / last_ctr) stay in routes/nfc.ts persistVerification.

export async function getCardByNfcUid(nfcUid: string): Promise<Card | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.cards.values()].find((ca) => ca.nfcUid.toLowerCase() === nfcUid.toLowerCase()) ?? null;
  }
  const { data, error } = await db.from("cards").select("*").ilike("nfc_uid", nfcUid).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}

export async function getCardByNfcShortId(shortId: string): Promise<Card | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.cards.values()].find((ca) => ca.nfcShortId === shortId) ?? null;
  }
  const { data, error } = await db.from("cards").select("*").eq("nfc_short_id", shortId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}

export async function listOwnershipByCard(cardId: string): Promise<OwnershipHistory[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.ownershipHistory
      .filter((h) => h.cardId === cardId)
      .sort((a, b) => new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime());
  }
  const { data, error } = await db
    .from("ownership_history")
    .select("*")
    .eq("card_id", cardId)
    .order("transferred_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapOwnershipRow(r as Record<string, unknown>));
}
