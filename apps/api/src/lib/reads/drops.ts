import { mapCardRow, mapDropRow, readDb } from "../reads.js";
import type { Card, Drop } from "../store.js";

// Domain reads: drops & cards (docs/13 Wave 1 — public select, no RPC needed).

export async function listDrops(): Promise<Drop[]> {
  const db = readDb();
  // ceiling working set — jangan muat tabel drop tanpa batas ke memori Worker
  const { data, error } = await db.from("drops").select("*").order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapDropRow(r as Record<string, unknown>));
}

/** Kartu ber-pemilik (browse secondary) — filter + kolom + ceiling di level DB. */
export async function listOwnedCards(): Promise<Card[]> {
  const db = readDb();
  const { data, error } = await db
    .from("cards")
    .select("id, drop_id, unit_number, variant, status, location, buyout_price_ccoin, owner_id, nfc_short_id")
    .not("owner_id", "is", null)
    .order("unit_number")
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

export async function getDropById(id: string): Promise<Drop | null> {
  const db = readDb();
  const { data, error } = await db.from("drops").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDropRow(data as Record<string, unknown>) : null;
}

export async function listCardsByDrop(dropId: string): Promise<Card[]> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").eq("drop_id", dropId).order("unit_number");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

/** Batch fetch by ids — 1 query untuk N kartu (hindari N+1 di order detail). */
export async function listCardsByIds(ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

export interface CardQuery {
  ownerId?: string;
  dropId?: string;
}

export async function listCards(query: CardQuery = {}): Promise<Card[]> {
  const db = readDb();
  let sel = db.from("cards").select("*");
  if (query.ownerId != null) sel = sel.eq("owner_id", query.ownerId);
  if (query.dropId != null) sel = sel.eq("drop_id", query.dropId);
  const { data, error } = await sel.order("unit_number");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

/** Resolve card by id OR nfcShortId (route params accept both). */
export async function getCardByIdOrNfc(idOrShort: string): Promise<Card | null> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").or(`id.eq.${idOrShort},nfc_short_id.eq.${idOrShort}`).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}
