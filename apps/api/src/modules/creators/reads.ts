import { readDb } from "../../lib/reads.js";

/**
 * Audit batch 2 F2: penanda "terjual" yang benar adalah baris ownership_history.
 * Semua transfer penjualan menulis di sana — checkout/draw (primary) dan
 * buyout_card/accept_bid/release_seed_sale (secondary) — sedangkan stok inventory,
 * seed yang baru di-listing di tangan kreator, escrow bid_pending, dan kartu
 * cacat yang belum pernah terjual TIDAK punya baris. Distinct card_id agar kartu
 * yang di-resale berulang tetap terhitung sekali per drop.
 */
export async function countCardsWithOwnershipHistory(cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const db = readDb();
  const { data, error } = await db.from("ownership_history").select("card_id").in("card_id", cardIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => String(r.card_id))).size;
}
