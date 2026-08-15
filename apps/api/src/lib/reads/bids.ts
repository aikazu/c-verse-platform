import { mapBidRow, readDb, seedOnce } from "../reads.js";
import type { Bid } from "../store.js";
import { store } from "../store.js";

// Domain reads: bids (docs 07 — 1 active per card, history 90 hari).

export async function listBidsByCard(cardId: string): Promise<Bid[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.bids.filter((b) => b.cardId === cardId);
  }
  const { data, error } = await db.from("bids").select("*").eq("card_id", cardId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapBidRow(r as Record<string, unknown>));
}

export interface BidQuery {
  cardId?: string;
  bidderId?: string;
  status?: Bid["status"];
}

export async function listBids(query: BidQuery = {}): Promise<Bid[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    let bids = [...store.bids];
    if (query.cardId != null) bids = bids.filter((b) => b.cardId === query.cardId);
    if (query.bidderId != null) bids = bids.filter((b) => b.bidderId === query.bidderId);
    if (query.status != null) bids = bids.filter((b) => b.status === query.status);
    return bids;
  }
  let sel = db.from("bids").select("*");
  if (query.cardId != null) sel = sel.eq("card_id", query.cardId);
  if (query.bidderId != null) sel = sel.eq("bidder_id", query.bidderId);
  if (query.status != null) sel = sel.eq("status", query.status);
  const { data, error } = await sel.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapBidRow(r as Record<string, unknown>));
}
