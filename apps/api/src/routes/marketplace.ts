import { C_COIN_RATE_IDR, MAX_BUYOUT_ACTIVE_PER_USER, splitSecondaryFeeCcoin } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { addTx, authHeaderToToken, ensureSeed, ensureWallet, getUserByToken, logAudit, nowIso, store, uid } from "../lib/store.js";

// Marketplace = buyout langsung di kartu (C-07 FINAL — legacy auction/listing dihapus, spec 16 F-02).

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}

function marketplaceFromCards() {
  return [...store.cards.values()].filter((ca) => ca.buyoutPriceCcoin != null && ca.buyoutPriceCcoin >= 1);
}

// GET / — kartu dengan harga buyout aktif
app.get("/", async (c) => {
  const q = c.req.query();
  const search = q.search?.toLowerCase();
  const mine = q.mine === "1";

  let cards = marketplaceFromCards();
  if (search) {
    cards = cards.filter((ca) => {
      const drop = store.drops.get(ca.dropId);
      const title = drop?.title.toLowerCase().includes(search) ?? false;
      const series = drop?.series.toLowerCase().includes(search) ?? false;
      return title || series || ca.nfcShortId.toLowerCase().includes(search);
    });
  }
  if (mine) {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (user) cards = cards.filter((ca) => ca.ownerId === user.id);
  }

  const marketplace = cards
    .sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0))
    .map((card) => {
      const drop = store.drops.get(card.dropId);
      const seller = card.ownerId ? store.users.get(card.ownerId) : null;
      return {
        kind: "buyout" as const,
        card,
        drop: drop
          ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, creatorName: drop.creatorName }
          : null,
        seller: seller ? { id: seller.id, displayName: seller.displayName } : null,
        buyoutPriceCcoin: card.buyoutPriceCcoin,
        idrPrice: (card.buyoutPriceCcoin ?? 0) * C_COIN_RATE_IDR,
      };
    });

  return c.json({ marketplace, cards: marketplace, listings: [], enriched: marketplace });
});

// POST / — pasang harga buyout di kartu milik sendiri (tanpa KYC — FINAL 2026-08-13)
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1),
      buyoutPriceCcoin: z.number().int().min(1).optional(),
      priceCCoin: z.number().int().min(1).optional(), // legacy alias
    }),
  ),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const raw = c.req.valid("json");
    const card = store.cards.get(raw.cardId);
    if (!card) return c.json({ error: "Card tidak ditemukan" }, 404);
    if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
    if (card.verifyStatus === "tamper_detected") return c.json({ error: "Kartu tamper — tidak bisa dipasarkan" }, 400);

    const price = raw.buyoutPriceCcoin ?? raw.priceCCoin;
    if (price == null) return c.json({ error: "buyoutPriceCcoin wajib (integer ≥ 1)" }, 400);

    const activeBuyouts = [...store.cards.values()].filter((ca) => ca.ownerId === user.id && ca.buyoutPriceCcoin != null).length;
    if (activeBuyouts >= MAX_BUYOUT_ACTIVE_PER_USER && card.buyoutPriceCcoin == null) {
      return c.json({ error: `Maksimum ${MAX_BUYOUT_ACTIVE_PER_USER} kartu buyout aktif per user` }, 400);
    }

    card.buyoutPriceCcoin = price;
    if (card.status === "sold" || card.status === "available") card.status = "listed_buyout" as never;
    logAudit(user.id, "update", "cards.buyout", card.id, { buyoutPriceCcoin: price }, c.req.header("x-forwarded-for") ?? null, null);
    return c.json({ card, buyoutPriceCcoin: price, marketplace: { card, buyoutPriceCcoin: price } }, 201);
  },
);

// POST /buyout — beli kartu di harga buyout (fee 7,5/7,5/85 via splitSecondaryFeeCcoin)
app.post("/buyout", zValidator("json", z.object({ cardId: z.string().min(1) })), async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { cardId } = c.req.valid("json");
  const card = store.cards.get(cardId);
  if (!card || card.buyoutPriceCcoin == null) return c.json({ error: "Kartu tidak dijual buyout" }, 404);
  if (card.ownerId === user.id) return c.json({ error: "Tidak bisa membeli kartu sendiri" }, 400);
  const price = card.buyoutPriceCcoin;

  // anti-fraud: wash 14d & creator self-dealing 30d
  const nowBuy = Date.now();
  const lastOwnBuy = store.ownershipHistory
    .filter((h) => h.cardId === cardId && h.ownerId === user.id)
    .sort((a, b) => new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime())[0];
  if (lastOwnBuy && nowBuy - new Date(lastOwnBuy.transferredAt).getTime() < 14 * 24 * 3600 * 1000) {
    return c.json({ error: "Cooling period 14 hari — tidak bisa membeli kembali kartu yang baru kamu jual", coolingDays: 14 }, 400);
  }
  const dropBuy = store.drops.get(card.dropId);
  if (dropBuy) {
    const isCreatorSelf =
      dropBuy.creatorId === user.id || [...store.creators.values()].some((cr) => cr.userId === user.id && cr.id === dropBuy.creatorId);
    if (isCreatorSelf) {
      const dStart = new Date(dropBuy.dropStartAt ?? dropBuy.dropAt ?? dropBuy.createdAt).getTime();
      if (nowBuy - dStart < 30 * 24 * 3600 * 1000)
        return c.json(
          { error: "Creator self-dealing dilarang 30 hari — kreator tidak bisa membeli kartu drop sendiri", cooldownDays: 30 },
          400,
        );
    }
  }

  const w = ensureWallet(user.id);
  if (w.balanceCCoin < price) return c.json({ error: "Saldo C-Coin tidak cukup", needCCoin: price, haveCCoin: w.balanceCCoin }, 402);

  const prevOwner = card.ownerId;
  if (!prevOwner) return c.json({ error: "Kartu tidak punya pemilik" }, 400);
  const drop = store.drops.get(card.dropId);
  if (!drop) return c.json({ error: "Drop kartu tidak ditemukan" }, 404);
  const { platformCcoin, royaltyCcoin, sellerCcoin } = splitSecondaryFeeCcoin(price);
  addTx(user.id, "platform_buy", -price, "card", card.id, `Buyout ${card.nfcShortId} — ${price} C-Coin`, {
    fee_rate_platform: 0.075,
    fee_rate_royalty: 0.075,
    fee_rate_seller: 0.85,
    price,
  });
  addTx(prevOwner, "settlement", sellerCcoin, "card", card.id, `Hasil buyout 85% — ${price} C-Coin`, {
    fee_rate_platform: 0.075,
    fee_rate_royalty: 0.075,
    fee_rate_seller: 0.85,
    price,
  });
  addTx(drop.creatorId, "royalty", royaltyCcoin, "card", card.id, `Royalty buyout 7,5% — ${drop.title}`, {
    fee_rate_platform: 0.075,
    fee_rate_royalty: 0.075,
    platformCcoin,
    price,
  });

  card.ownerId = user.id;
  card.buyoutPriceCcoin = null;
  card.status = "sold";

  // bid aktif di kartu ini di-outbid + release hold
  for (const b of store.bids.filter((b) => b.cardId === card.id && b.status === "active")) {
    addTx(b.bidderId, "escrow_release", b.amountCCoin, "bid", b.id, "Outbid release — buyout taken");
    b.status = "outbid";
    b.outbidAt = nowIso();
  }
  store.ownershipHistory.push({
    id: uid("oh-"),
    cardId,
    ownerId: user.id,
    acquiredVia: "secondary_buyout",
    orderId: null,
    bidId: null,
    transferredAt: nowIso(),
  });
  return c.json({
    ok: true,
    card,
    needShipmentChoice: true,
    hint: "Pilih tujuan kirim: ke alamat buyer (ongkir C-Coin) atau kirim/rawat di platform (vault).",
  });
});

// PATCH /cards/:id/buyout — ubah/hapus harga buyout
app.patch("/cards/:id/buyout", zValidator("json", z.object({ buyoutPriceCcoin: z.number().int().min(1).nullable() })), async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const card = store.cards.get(c.req.param("id"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  if (card.ownerId !== user.id) return c.json({ error: "Bukan pemilik" }, 403);
  const { buyoutPriceCcoin } = c.req.valid("json");
  card.buyoutPriceCcoin = buyoutPriceCcoin;
  if (buyoutPriceCcoin == null && (card.status === "listed_buyout" || card.status === "listed")) card.status = "sold";
  if (buyoutPriceCcoin != null && card.status === "sold") card.status = "listed_buyout" as never;
  return c.json({ card });
});

// DELETE /:cardId — cabut buyout (by card id)
app.delete("/:id", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const card = store.cards.get(c.req.param("id"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  if (card.ownerId !== user.id && (user.role as string) !== "admin") return c.json({ error: "Forbidden" }, 403);
  card.buyoutPriceCcoin = null;
  if (card.status === "listed_buyout") card.status = "sold";
  return c.json({ ok: true, card });
});

export default app;
