import { mapCardRow, type Row, readDb, seedOnce } from "../reads.js";
import type { Card } from "../store.js";
import { store } from "../store.js";

// Domain reads: marketplace buyout-on-card listings (docs 07 C-07 — no separate listing table,
// buyout_price_ccoin lives on cards).

export async function listMarketplaceCards(): Promise<Card[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.cards.values()].filter((ca) => ca.buyoutPriceCcoin != null && ca.buyoutPriceCcoin >= 1);
  }
  // gte implicitly excludes NULL buyout prices (comparison with NULL is not true)
  const { data, error } = await db.from("cards").select("*").gte("buyout_price_ccoin", 1).order("buyout_price_ccoin");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Row));
}
