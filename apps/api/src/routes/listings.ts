import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, uid, nowIso } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) { return getUserByToken(authHeaderToToken(c.req.header("authorization"))); }

app.get("/", async (c) => {
  const q = c.req.query();
  const status = q.status as string | undefined;
  const type = q.type as string | undefined;
  let listings = [...store.listings.values()];
  if (status && status !== "all") listings = listings.filter(l => l.status === status);
  if (type) listings = listings.filter(l => l.type === type);
  listings.sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const enriched = listings.map(l => {
    const card = store.cards.get(l.cardId);
    const drop = card ? store.drops.get(card.dropId) : null;
    const seller = store.users.get(l.sellerId);
    return { ...l, card, drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null, sellerName: seller?.displayName ?? "Unknown", idrPrice: l.priceCCoin * C_COIN_RATE_IDR, idrCurrentBid: l.currentBidCCoin ? l.currentBidCCoin * C_COIN_RATE_IDR : null };
  });
  return c.json({ listings: enriched });
});

app.get("/:id", async (c) => {
  const l = store.listings.get(c.req.param("id"));
  if (!l) return c.json({ error: "Listing tidak ditemukan" }, 404);
  const card = store.cards.get(l.cardId);
  const drop = card ? store.drops.get(card.dropId) : null;
  const seller = store.users.get(l.sellerId);
  const bids = store.bids.filter(b => b.listingId === l.id).sort((a,b)=> b.amountCCoin - a.amountCCoin);
  return c.json({ listing: { ...l, idrPrice: l.priceCCoin * C_COIN_RATE_IDR }, card, drop, seller: seller ? { id: seller.id, displayName: seller.displayName } : null, bids });
});

app.post("/", zValidator("json", z.object({
  cardId: z.string().min(1),
  type: z.enum(["fixed","auction"]).default("fixed"),
  priceCCoin: z.number().int().min(1),
  reserveCCoin: z.number().int().min(0).optional(),
  durationDays: z.number().int().min(1).max(14).default(7),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = c.req.valid("json");
  const card = store.cards.get(body.cardId);
  if (!card) return c.json({ error: "Card tidak ditemukan" }, 404);
  if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
  if (card.verifyStatus === "tamper_detected") return c.json({ error: "Kartu tamper — tidak bisa listing" }, 400);
  // KYC gate for > 100 C-Coin (~1jt)
  if (body.priceCCoin > 100) {
    const kyc = [...store.kyc.values()].find(k => k.userId === user.id && k.status === "approved");
    if (!kyc) return c.json({ error: "KYC diperlukan untuk listing > 100 C-Coin (Rp 1 juta)", needKyc: true }, 400);
  }
  const existing = [...store.listings.values()].find(l => l.cardId === body.cardId && ["listed","bidding","awaiting_settlement"].includes(l.status));
  if (existing) return c.json({ error: "Kartu sudah ada listing aktif" }, 400);
  const id = uid("lst-");
  const listing = {
    id, cardId: body.cardId, sellerId: user.id, type: body.type as "fixed"|"auction",
    priceCCoin: body.priceCCoin, reserveCCoin: body.reserveCCoin ?? null,
    currentBidCCoin: null, currentBidderId: null,
    status: (body.type === "auction" ? "bidding" : "listed") as any,
    endsAt: new Date(Date.now() + body.durationDays*86400_000).toISOString(),
    createdAt: nowIso(),
  };
  store.listings.set(id, listing);
  card.status = "listed";
  return c.json({ listing }, 201);
});

app.post("/:id/buy-now", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const l = store.listings.get(c.req.param("id"));
  if (!l) return c.json({ error: "Listing tidak ditemukan" }, 404);
  if (l.type !== "fixed") return c.json({ error: "Hanya fixed-price yang bisa buy-now" }, 400);
  if (l.status !== "listed") return c.json({ error: `Status listing: ${l.status}` }, 400);
  if (l.sellerId === user.id) return c.json({ error: "Tidak bisa beli listing sendiri" }, 400);
  const { ensureWallet, addTx } = await import("../lib/store.js");
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < l.priceCCoin) return c.json({ error: "Saldo C-Coin tidak cukup", needCCoin: l.priceCCoin, haveCCoin: w.balanceCCoin }, 402);
  // Deduct buyer
  addTx(user.id, "checkout", -l.priceCCoin, "listing", l.id, `Buy-now listing ${l.id} — ${l.priceCCoin} C-Coin`);
  // Settle: 85% seller, 7.5% platform, 7.5% creator royalty
  const sellerNet = Math.floor(l.priceCCoin * 0.85);
  const royalty = Math.floor(l.priceCCoin * 0.075);
  const card = store.cards.get(l.cardId)!;
  const drop = store.drops.get(card.dropId)!;
  addTx(l.sellerId, "payout", sellerNet, "listing", l.id, `Hasil jual secondary (85%) — ${l.priceCCoin} C-Coin`);
  addTx(drop.creatorId, "royalty", royalty, "listing", l.id, `Royalty secondary 7.5% — ${drop.title}`);
  // Transfer ownership
  card.ownerId = user.id; card.status = "sold";
  l.status = "settled" as any;
  user.xp += 30;
  return c.json({ ok: true, listing: l, card });
});

app.delete("/:id", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const l = store.listings.get(c.req.param("id"));
  if (!l) return c.json({ error: "Not found" }, 404);
  if (l.sellerId !== user.id && user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  if (l.status === "settled") return c.json({ error: "Sudah settled" }, 400);
  l.status = "cancelled" as any;
  const card = store.cards.get(l.cardId);
  if (card) card.status = "sold";
  return c.json({ ok: true });
});

export default app;
