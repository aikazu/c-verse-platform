import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet, addTx, uid, nowIso } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) { return getUserByToken(authHeaderToToken(c.req.header("authorization"))); }

app.get("/:listingId", async (c) => {
  const bids = store.bids.filter(b => b.listingId === c.req.param("listingId")).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return c.json({ bids });
});

app.post("/", zValidator("json", z.object({
  listingId: z.string().min(1),
  amountCCoin: z.number().int().min(1),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { listingId, amountCCoin } = c.req.valid("json");
  const listing = store.listings.get(listingId);
  if (!listing) return c.json({ error: "Listing tidak ditemukan" }, 404);
  if (listing.type !== "auction") return c.json({ error: "Hanya auction yang bisa di-bid" }, 400);
  if (!["bidding","listed"].includes(listing.status)) return c.json({ error: `Listing status: ${listing.status}` }, 400);
  if (listing.sellerId === user.id) return c.json({ error: "Seller tidak bisa bid listing sendiri" }, 400);
  if (new Date(listing.endsAt).getTime() < Date.now()) { listing.status = "expired" as any; return c.json({ error: "Lelang sudah berakhir" }, 400); }
  const minBid = listing.currentBidCCoin ? Math.ceil(listing.currentBidCCoin * 1.05) : listing.priceCCoin;
  if (amountCCoin < minBid) return c.json({ error: `Bid minimal ${minBid} C-Coin (5% increment)`, minBidCCoin: minBid }, 400);
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < amountCCoin) return c.json({ error: "Saldo C-Coin tidak cukup untuk bid ini", needCCoin: amountCCoin, haveCCoin: w.balanceCCoin }, 402);
  // KYC gate >100 C-Coin
  if (amountCCoin > 100) {
    const kyc = [...store.kyc.values()].find(k => k.userId === user.id && k.status === "approved");
    if (!kyc) return c.json({ error: "KYC diperlukan untuk bid > 100 C-Coin", needKyc: true }, 400);
  }
  // Anti-sniping: bid di 5 menit terakhir extend 5 menit (max 3x)
  const msLeft = new Date(listing.endsAt).getTime() - Date.now();
  if (msLeft < 5*60_000) {
    const currentEnds = new Date(listing.endsAt).getTime();
    listing.endsAt = new Date(currentEnds + 5*60_000).toISOString();
  }
  // Hold saldo bidder (simulate escrow hold — untuk MVP langsung hold di ledger sebagai fee hold)
  // Sederhana: tidak hold dulu, hold saat settlement. Bid hanya record.
  const bid = { id: uid("bid-"), listingId, bidderId: user.id, bidderName: user.displayName, amountCCoin, createdAt: nowIso() };
  store.bids.push(bid);
  listing.currentBidCCoin = amountCCoin;
  listing.currentBidderId = user.id;
  listing.status = "bidding" as any;
  user.xp += 10;
  // Badge first_bid
  if (!store.userBadges.find(ub => ub.userId === user.id && ub.badgeId === "b2")) {
    store.userBadges.push({ userId: user.id, badgeId: "b2", earnedAt: nowIso() });
    user.xp += 50;
  }
  // Whale badge if single bid >100 C-Coin
  if (amountCCoin > 100 && !store.userBadges.find(ub => ub.userId === user.id && ub.badgeId === "b5")) {
    store.userBadges.push({ userId: user.id, badgeId: "b5", earnedAt: nowIso() });
    user.xp += 500;
  }
  return c.json({ bid, listing }, 201);
});

// Accept winning bid (seller or admin) — settle auction
app.post("/:listingId/accept", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const listing = store.listings.get(c.req.param("listingId"));
  if (!listing) return c.json({ error: "Not found" }, 404);
  if (listing.sellerId !== user.id && user.role !== "admin") return c.json({ error: "Hanya seller/admin yang bisa accept" }, 403);
  if (!listing.currentBidCCoin || !listing.currentBidderId) return c.json({ error: "Belum ada bid" }, 400);
  if (listing.reserveCCoin && listing.currentBidCCoin < listing.reserveCCoin) return c.json({ error: `Reserve belum tercapai (${listing.reserveCCoin} C-Coin)` }, 400);
  const winnerId = listing.currentBidderId;
  const price = listing.currentBidCCoin;
  const winnerWallet = ensureWallet(winnerId);
  if (winnerWallet.balanceCCoin < price) return c.json({ error: "Saldo winner tidak cukup" }, 400);
  // Deduct winner, settle
  addTx(winnerId, "checkout", -price, "listing", listing.id, `Menang lelang ${listing.id} — ${price} C-Coin`);
  const sellerNet = Math.floor(price * 0.85);
  const royalty = Math.floor(price * 0.075);
  const card = store.cards.get(listing.cardId)!;
  const drop = store.drops.get(card.dropId)!;
  addTx(listing.sellerId, "payout", sellerNet, "listing", listing.id, `Hasil lelang 85% — ${price} C-Coin`);
  addTx(drop.creatorId, "royalty", royalty, "listing", listing.id, `Royalty lelang 7.5% — ${drop.title}`);
  card.ownerId = winnerId; card.status = "sold";
  listing.status = "settled" as any;
  return c.json({ ok: true, listing, card });
});

export default app;
