import { mapCardRow, type Row, readDb } from "../reads.js";
import type { Card } from "../store.js";

// Domain reads: marketplace buyout-on-card listings (docs 07 C-07 — no separate listing table,
// buyout_price_ccoin lives on cards).

export async function listMarketplaceCards(): Promise<Card[]> {
  const db = readDb();
  // gte implicitly excludes NULL buyout prices (comparison with NULL is not true);
  // Defensive: juga filter ke status yang BOLEH listing — sinkron dengan set_buyout
  // (status transitions: bound/sold -> listed_buyout; NULL buyout saat unlisted).
  // Non-tradable statuses (tampered/defect/lost) = CARD_NOT_TRADABLE di semua RPC.
  // Auto-unlist via trigger (20260823020000_seed_xp_unify.sql §3) sudah NULL-kan
  // buyout_price_ccoin; filter ini = belt-and-suspenders kalau trigger terlewat.
  // ceiling working set — listing dibatasi MAX_BUYOUT 20/user jadi 2000 sangat longgar.
  const { data, error } = await db
    .from("cards")
    .select("*")
    .gte("buyout_price_ccoin", 1)
    .in("status", ["inventory", "bound", "listed_buyout", "sold"])
    .order("buyout_price_ccoin")
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Row));
}
