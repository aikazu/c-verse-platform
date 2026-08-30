import { Hono } from "hono";
import { listBidsByCard } from "../../lib/reads/bids.js";
import { getCardByIdOrNfc, getDropById } from "../../lib/reads/drops.js";
import { listUsersByIds } from "../../lib/reads/users.js";
import type { Bid, User } from "../../lib/store.js";

const app = new Hono();

// Privacy (A3): akun anonim/flagged (suspended) tidak pernah menampilkan nama —
// aturan masking yang sama dengan seller marketplace dan owner NFC.
function publicDisplayName(user: Pick<User, "displayName" | "isAnonymous" | "flagReason"> | null): string {
  return user && !user.isAnonymous && user.flagReason == null ? user.displayName : "Anonim";
}

// bidder_name adalah kolom denormalized di bids; masking di read boundary.
// Bidder yang hilang dari tabel users dimasking defensif.
async function maskBidderNames(bids: Bid[]): Promise<Bid[]> {
  if (bids.length === 0) return bids;
  const bidderById = new Map((await listUsersByIds([...new Set(bids.map((b) => b.bidderId))])).map((u) => [u.id, u]));
  return bids.map((b) => {
    const bidder = bidderById.get(b.bidderId);
    const isMasked = !bidder || bidder.isAnonymous || bidder.flagReason != null;
    return isMasked ? { ...b, bidderName: "Anonim" } : b;
  });
}

// GET /cards/:id — single card browse detail (same as nfc /cards/:id but via
// browse mount for convenience). Identitas owner & bidder dimasking (A3).
// Catatan: flat GET /api/browse dihapus — konsumen tunggalnya (web Browse.tsx)
// pindah ke GET /api/drops + GET /api/drops/:id/cards (B1).
app.get("/cards/:id", async (c) => {
  const card = await getCardByIdOrNfc(c.req.param("id"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const drop = await getDropById(card.dropId);
  const owner = card.ownerId ? ((await listUsersByIds([card.ownerId]))[0] ?? null) : null;
  const sorted = (await listBidsByCard(card.id)).sort((a, b) => b.amountCCoin - a.amountCCoin);
  const bids = await maskBidderNames(sorted);
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  return c.json({
    card,
    drop,
    owner: owner ? { id: owner.id, displayName: publicDisplayName(owner) } : null,
    activeBid,
    bids: bids.slice(0, 20),
  });
});

export default app;
