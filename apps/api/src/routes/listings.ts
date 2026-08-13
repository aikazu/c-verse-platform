import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, uid, nowIso, logAudit } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}

// Build marketplace view from cards.buyout_price_ccoin (primary source per 05-data-model)
function marketplaceFromCards() {
  return [...store.cards.values()].filter((ca) => ca.buyoutPriceCcoin != null && ca.buyoutPriceCcoin >= 1);
}

// Legacy: mirror to listings for UI that still reads /api/listings
function syncListingsFromBuyouts() {
  // No-op for now; listings kept as compat read
}

// GET / — marketplace (cards with buyout price)
app.get("/", async (c) => {
  const q = c.req.query();
  const search = (q.search as string | undefined)?.toLowerCase();
  const mine = q.mine === "1";

  // Cards-based marketplace (new)
  let cards = marketplaceFromCards();
  if (search) {
    cards = cards.filter((ca) => {
      const drop = store.drops.get(ca.dropId);
      return (drop?.title.toLowerCase().includes(search) ?? false) || (drop?.series.toLowerCase().includes(search) ?? false) || ca.nfcShortId.toLowerCase().includes(search);
    });
  }
  if (mine) {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (user) cards = cards.filter((ca) => ca.ownerId === user.id);
  }

  const marketplace = cards
    .sort((a, b) => (a.buyoutPriceCcoin! - b.buyoutPriceCcoin!))
    .map((card) => {
      const drop = store.drops.get(card.dropId);
      const seller = card.ownerId ? store.users.get(card.ownerId) : null;
      return {
        kind: "buyout" as const,
        card,
        drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, creatorName: drop.creatorName } : null,
        seller: seller ? { id: seller.id, displayName: seller.displayName } : null,
        buyoutPriceCcoin: card.buyoutPriceCcoin,
        idrPrice: (card.buyoutPriceCcoin ?? 0) * C_COIN_RATE_IDR,
      };
    });

  // Also include legacy listings (fixed only) for compat — map to same shape
  const listingsCompat = [...store.listings.values()]
    .filter((l) => l.type === "fixed" && ["listed", "bidding"].includes(l.status))
    .map((l) => {
      const card = store.cards.get(l.cardId);
      const drop = card ? store.drops.get(card.dropId) : null;
      const seller = store.users.get(l.sellerId);
      return {
        kind: "listing_compat" as const,
        listing: { ...l, idrPrice: l.priceCCoin * C_COIN_RATE_IDR },
        card,
        drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
        seller: seller ? { id: seller.id, displayName: seller.displayName } : null,
      };
    });

  // Primary response: marketplace (new) + listings for compat (UI can read either)
  return c.json({ listings: listingsCompat, marketplace, cards: marketplace, enriched: marketplace });
});

// GET /marketplace alias (some clients call /marketplace)
app.get("/marketplace", async (c) => {
  const url = new URL(c.req.url);
  const search = url.searchParams.get("search") ?? undefined;
  let cards = marketplaceFromCards();
  if (search) {
    const s = search.toLowerCase();
    cards = cards.filter((ca) => {
      const d = store.drops.get(ca.dropId);
      return (d?.title.toLowerCase().includes(s) ?? false) || (d?.series.toLowerCase().includes(s) ?? false);
    });
  }
  return c.json({
    marketplace: cards.map((card) => ({
      card,
      drop: store.drops.get(card.dropId),
      buyoutPriceCcoin: card.buyoutPriceCcoin,
      idrPrice: (card.buyoutPriceCcoin ?? 0) * C_COIN_RATE_IDR,
    })),
  });
});

app.get("/:id", async (c) => {
  const l = store.listings.get(c.req.param("id"));
  if (!l) return c.json({ error: "Listing tidak ditemukan" }, 404);
  const card = store.cards.get(l.cardId);
  const drop = card ? store.drops.get(card.dropId) : null;
  const seller = store.users.get(l.sellerId);
  const bids = store.bids.filter((b) => b.listingId === l.id).sort((a, b) => b.amountCCoin - a.amountCCoin);
  return c.json({ listing: { ...l, idrPrice: l.priceCCoin * C_COIN_RATE_IDR }, card, drop, seller: seller ? { id: seller.id, displayName: seller.displayName } : null, bids });
});

// POST / — set buyout price on owned card (marketplace); replaces legacy POST / listings fixed
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1),
      type: z.enum(["fixed", "auction"]).optional(),
      priceCCoin: z.number().int().min(1).optional(),
      buyoutPriceCcoin: z.number().int().min(1).optional(),
      reserveCCoin: z.number().int().min(0).optional(),
      durationDays: z.number().int().min(1).max(14).optional(),
    }),
  ),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const raw = c.req.valid("json") as { cardId: string; type?: string; priceCCoin?: number; buyoutPriceCcoin?: number };
    const card = store.cards.get(raw.cardId);
    if (!card) return c.json({ error: "Card tidak ditemukan" }, 404);
    if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
    if (card.verifyStatus === "tamper_detected") return c.json({ error: "Kartu tamper — tidak bisa dipasarkan" }, 400);

    const price = raw.buyoutPriceCcoin ?? raw.priceCCoin;
    if (price == null) return c.json({ error: "buyoutPriceCcoin wajib (integer ≥ 1)" }, 400);

    // FINAL 2026-08-13 — TIDAK ada KYC untuk pasang buyout (docs/07 C-05b validasi lawyer: hanya payout + topup besar).

    // Guard max 20 buyout aktif per user (05-data-model I10)
    const activeBuyouts = [...store.cards.values()].filter((ca) => ca.ownerId === user.id && ca.buyoutPriceCcoin != null).length;
    if (activeBuyouts >= 20 && card.buyoutPriceCcoin == null) return c.json({ error: "Maksimum 20 kartu buyout aktif per user" }, 400);

    // If caller explicitly wants auction behaviour, keep legacy listing path for that one compat case
    if (raw.type === "auction") {
      const id = uid("lst-");
      const listing = {
        id,
        cardId: raw.cardId,
        sellerId: user.id,
        type: "auction" as const,
        priceCCoin: price,
        reserveCCoin: (raw as unknown as { reserveCCoin?: number }).reserveCCoin ?? null,
        currentBidCCoin: null as number | null,
        currentBidderId: null as string | null,
        status: "bidding" as const,
        endsAt: new Date(Date.now() + (((raw as unknown as { durationDays?: number }).durationDays ?? 7) * 86400000)).toISOString(),
        createdAt: nowIso(),
      };
      store.listings.set(id, listing as never);
      card.status = "listed";
      logAudit(user.id, "create", "listings", id, { cardId: raw.cardId, type: "auction", price }, c.req.header("x-forwarded-for") ?? null, authHeaderToToken(c.req.header("authorization")) ?? null);
      return c.json({ listing }, 201);
    }

    card.buyoutPriceCcoin = price;
    if (card.status === "sold" || card.status === "available") card.status = "listed_buyout" as never;
    logAudit(user.id, "create", "cards.buyout", card.id, { buyoutPriceCcoin: price }, c.req.header("x-forwarded-for") ?? null, authHeaderToToken(c.req.header("authorization")) ?? null);
    return c.json({ card, buyoutPriceCcoin: price, marketplace: { card, buyoutPriceCcoin: price } }, 201);
  },
);

// POST /buyout — buy direct at buyout price (new) and POST /:id/buy-now compat
app.post("/buyout", zValidator("json", z.object({ cardId: z.string().min(1) })), async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { cardId } = c.req.valid("json");
  const card = store.cards.get(cardId);
  if (!card || card.buyoutPriceCcoin == null) return c.json({ error: "Kartu tidak dijual buyout" }, 404);
  if (card.ownerId === user.id) return c.json({ error: "Tidak bisa membeli kartu sendiri" }, 400);
  const price = card.buyoutPriceCcoin;
  const { ensureWallet, addTx, store: s } = await import("../lib/store.js");
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < price) return c.json({ error: "Saldo C-Coin tidak cukup", needCCoin: price, haveCCoin: w.balanceCCoin }, 402);
  const prevOwner = card.ownerId!;
  const drop = store.drops.get(card.dropId)!;
  addTx(user.id, "checkout", -price, "card", card.id, `Buyout ${card.nfcShortId} — ${price} C-Coin`);
  const sellerNet = Math.floor(price * 0.85);
  const royalty = Math.floor(price * 0.075);
  addTx(prevOwner, "payout", sellerNet, "card", card.id, `Hasil buyout 85% — ${price} C-Coin`);
  addTx(drop.creatorId, "royalty", royalty, "card", card.id, `Royalty buyout 7.5% — ${drop.title}`);
  card.ownerId = user.id;
  card.buyoutPriceCcoin = null;
  card.status = "sold";
  // clear bids on this card (outbid release)
  for (const b of store.bids.filter((b) => b.cardId === card.id && b.status === "active")) {
    const bidderWallet = ensureWallet(b.bidderId);
    // release held amount (tx already held at bid time as hold; here refund)
    const held = store.walletTx.find((t) => t.refId === b.id);
    if (held) addTx(b.bidderId, "release", b.amountCCoin, "bid", b.id, `Outbid release — buyout taken`);
    b.status = "outbid";
    (b as unknown as Record<string, unknown>).outbidAt = nowIso();
  }
  store.ownershipHistory.push({ id: uid("oh-"), cardId, ownerId: user.id, acquiredVia: "secondary_buyout", orderId: null, bidId: null, transferredAt: nowIso() });
  return c.json({ ok: true, card, needShipmentChoice: true, hint: "Pilih tujuan kirim: ke alamat buyer (ongkir C-Coin) atau kirim/rawat di platform (vault)." });
});

app.post("/:id/buy-now", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const l = store.listings.get(c.req.param("id"));
  if (!l) return c.json({ error: "Listing tidak ditemukan" }, 404);
  if (l.type !== "fixed") return c.json({ error: "Hanya fixed-price yang bisa buy-now" }, 400);
  if (l.status !== "listed") return c.json({ error: `Status listing: ${l.status}` }, 400);
  if (l.sellerId === user.id) return c.json({ error: "Tidak bisa beli listing sendiri" }, 400);
  const { ensureWallet, addTx } = await import("../lib/store.js");
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < l.priceCCoin) return c.json({ error: "Saldo C-Coin tidak cukup", needCCoin: l.priceCCoin, haveCCoin: w.balanceCCoin }, 402);
  addTx(user.id, "checkout", -l.priceCCoin, "listing", l.id, `Buy-now listing ${l.id} — ${l.priceCCoin} C-Coin`);
  const sellerNet = Math.floor(l.priceCCoin * 0.85);
  const royalty = Math.floor(l.priceCCoin * 0.075);
  const card = store.cards.get(l.cardId)!;
  const drop = store.drops.get(card.dropId)!;
  addTx(l.sellerId, "payout", sellerNet, "listing", l.id, `Hasil jual secondary (85%) — ${l.priceCCoin} C-Coin`);
  addTx(drop.creatorId, "royalty", royalty, "listing", l.id, `Royalty secondary 7.5% — ${drop.title}`);
  card.ownerId = user.id;
  card.status = "sold";
  (card as unknown as Record<string, unknown>).buyoutPriceCcoin = null;
  l.status = "settled" as never;
  return c.json({ ok: true, listing: l, card });
});

// PATCH /cards/:id/buyout — update/remove buyout
app.patch("/cards/:id/buyout", zValidator("json", z.object({ buyoutPriceCcoin: z.number().int().min(1).nullable() })), async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const card = store.cards.get(c.req.param("id"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  if (card.ownerId !== user.id) return c.json({ error: "Bukan pemilik" }, 403);
  const { buyoutPriceCcoin } = c.req.valid("json");
  if (buyoutPriceCcoin == null) {
    card.buyoutPriceCcoin = null;
    if ((card.status as string) === "listed_buyout" || (card.status as string) === "listed") card.status = "sold";
    return c.json({ card });
  }
  // FINAL: tidak ada KYC untuk update buyout
  card.buyoutPriceCcoin = buyoutPriceCcoin;
  if ((card.status as string) === "sold") card.status = "listed_buyout" as never;
  return c.json({ card });
});

app.delete("/:id", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const l = store.listings.get(c.req.param("id"));
  if (!l) {
    const card = store.cards.get(c.req.param("id"));
    if (card && card.ownerId === user.id) {
      card.buyoutPriceCcoin = null;
      if ((card.status as string) === "listed_buyout") card.status = "sold";
      return c.json({ ok: true, card });
    }
    return c.json({ error: "Not found" }, 404);
  }
  if (l.sellerId !== user.id && (user.role as string) !== "admin") return c.json({ error: "Forbidden" }, 403);
  if (l.status === "settled") return c.json({ error: "Sudah settled" }, 400);
  l.status = "cancelled" as never;
  const card = store.cards.get(l.cardId);
  if (card) card.status = "sold";
  return c.json({ ok: true });
});

export default app;
