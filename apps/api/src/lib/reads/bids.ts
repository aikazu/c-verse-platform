import { mapBidRow, readDb } from "../reads.js";
import type { Bid } from "../store.js";

// Domain reads: bids (docs 07 — 1 active per card, history 90 hari).
// Single selector: filter by card/bidder/status — no per-field duplicate wrappers.

export interface BidQuery {
  cardId?: string;
  bidderId?: string;
  status?: Bid["status"];
}

export async function listBids(query: BidQuery = {}): Promise<Bid[]> {
  const db = readDb();
  let sel = db.from("bids").select("*");
  if (query.cardId != null) sel = sel.eq("card_id", query.cardId);
  if (query.bidderId != null) sel = sel.eq("bidder_id", query.bidderId);
  if (query.status != null) sel = sel.eq("status", query.status);
  const { data, error } = await sel.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapBidRow(r as Record<string, unknown>));
}
