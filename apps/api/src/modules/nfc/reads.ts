import { mapCardRow, mapOwnershipRow, readDb } from "../../lib/reads.js";
import type { Card, OwnershipHistory } from "../../lib/store.js";

// Domain reads: NFC card lookup & ownership history (docs/13 §3 Wave 5).
// Card writes (verify_status / last_ctr) stay in modules/nfc/routes.ts persistVerification.

// Canonical uid rule (mirrors verifyTap in routes.ts: 7-byte UID = hex, ≤14 chars).
// DB uids are uppercase-normalized (only writer is seed.sql `upper(md5(...))` and the
// unique b-tree index on nfc_uid is case-sensitive), so an exact .eq on the uppercased
// input hits the index — no ilike, no wildcard enumeration surface.
const NFC_UID_PATTERN = /^[0-9a-fA-F]{1,14}$/;

export async function getCardByNfcUid(nfcUid: string): Promise<Card | null> {
  // ?uid= is unauthenticated input: reject non-hex / wildcard payloads pre-query
  // (invalid uid follows the existing not-found path, never a 500).
  if (!NFC_UID_PATTERN.test(nfcUid)) return null;
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").eq("nfc_uid", nfcUid.toUpperCase()).maybeSingle();
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
