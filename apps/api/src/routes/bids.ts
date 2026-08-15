import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet, addTx, uid, nowIso, awardBadgeIfNeeded } from "../lib/store.js";
import { splitSecondaryFeeCcoin } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}

// GET bids for a card
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const bids = store.bids.filter((b) => b.cardId === id);
  bids.sort((a, b) => b.amountCCoin - a.amountCCoin || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ bids });
});

app.get("/card/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const windowDays = Number(c.req.query("days") ?? 90);
  const cutoff = Date.now() - windowDays * 86400000;
  const bids = store.bids
    .filter((b) => b.cardId === cardId)
    .filter((b) => b.status === "accepted" || new Date(b.createdAt).getTime() >= cutoff)
    .sort((a, b) => b.amountCCoin - a.amountCCoin || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ bids });
});

// POST / — place bid directly on card (docs 03 Flow 7: outbid + hold)
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1).optional(),
      amountCCoin: z.number().int().min(1).optional(),
      amountCcoin: z.number().int().min(1).optional(),
      amount_ccoin: z.number().int().min(1).optional(),
    }),
  ),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const raw = c.req.valid("json") as { cardId?: string; amountCCoin?: number; amountCcoin?: number; amount_ccoin?: number };
    const cardId = raw.cardId ?? null;
    if (!cardId) return c.json({ error: "cardId wajib (bid langsung di kartu)" }, 400);
    const amount = raw.amountCcoin ?? raw.amountCCoin ?? raw.amount_ccoin;
    if (amount == null || amount < 1) return c.json({ error: "amount wajib integer ≥ 1" }, 400);

    const card = store.cards.get(cardId);
    if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
    if (card.ownerId === user.id) return c.json({ error: "Tidak bisa bid kartu sendiri" }, 400);
    if (card.verifyStatus === "tamper_detected") return c.json({ error: "Kartu tamper — tidak bisa di-bid" }, 400);

    // Docs 03 Flow 7: 1 active tertinggi/kartu; bid lebih tinggi outbid; C-Coin di-hold
    // Y1 anti-fraud: rate limit + cooling guards
    const now = Date.now();
    const activeBidsForUser = store.bids.filter((b) => b.bidderId === user.id && b.status === "active").length;
    if (activeBidsForUser >= 10) return c.json({ error: "Batas 10 bid aktif per user — cancel salah satu dulu", limit: 10 }, 429);
    const bidsToday = store.bids.filter((b) => b.bidderId === user.id && now - new Date(b.createdAt).getTime() < 24*3600*1000).length;
    if (bidsToday >= 50) return c.json({ error: "Batas 50 bid per hari", limit: 50 }, 429);
    // wash trading cooling 14 hari (docs 05 I13, 07 C-12): owner sebelumnya tidak bisa bid/beli kembali kartunya
    const lastOwn = store.ownershipHistory.filter((h) => h.cardId === cardId && h.ownerId === user.id).sort((a,b)=> new Date(b.transferredAt).getTime()-new Date(a.transferredAt).getTime())[0];
    if (lastOwn && now - new Date(lastOwn.transferredAt).getTime() < 14*24*3600*1000) {
      return c.json({ error: "Cooling period 14 hari — kartu baru saja kamu jual, belum bisa di-bid kembali", coolingDays: 14 }, 400);
    }
    // creator self-dealing 30 hari (docs 05 I14, 07 C-13): kreator dilarang beli kartu drop sendiri 30 hari pertama
    const dropForCheck = store.drops.get(card.dropId);
    if (dropForCheck) {
      const isCreatorSelf = dropForCheck.creatorId === user.id || [...store.creators.values()].some((cr) => cr.userId === user.id && cr.id === dropForCheck.creatorId);
      if (isCreatorSelf) {
        const dropStart = new Date((dropForCheck as unknown as { dropStartAt?: string | null }).dropStartAt ?? (dropForCheck as unknown as { dropAt?: string | null }).dropAt ?? dropForCheck.createdAt).getTime();
        if (now - dropStart < 30*24*3600*1000) {
          return c.json({ error: "Creator self-dealing dilarang 30 hari setelah drop — kreator tidak bisa membeli kartu drop sendiri", cooldownDays: 30 }, 400);
        }
      }
    }
    const active = store.bids.find((b) => b.cardId === cardId && b.status === "active");
    if (active && amount <= active.amountCCoin) {
      return c.json({ error: `Bid harus lebih tinggi dari active tertinggi (${active.amountCCoin} C-Coin)`, minBidCCoin: active.amountCCoin + 1, activeBid: active }, 400);
    }

    const w = ensureWallet(user.id);
    if (w.balanceCCoin < amount) return c.json({ error: "Saldo C-Coin tidak cukup untuk hold bid ini", needCCoin: amount, haveCCoin: w.balanceCCoin }, 402);

    // Hold: deduct from bidder (escrow_hold)
    addTx(user.id, "escrow_hold", -amount, "bid", `hold-${Date.now()}`, `Hold bid ${amount} C-Coin untuk ${card.nfcShortId}`, { cardId, amount });

    // Outbid previous active: status outbid + release its holder
    if (active) {
      active.status = "outbid";
      active.outbidAt = nowIso();
      addTx(active.bidderId, "escrow_release", active.amountCCoin, "bid", active.id, `Outbid release — kembali ke saldo (${active.amountCCoin} C-Coin)`);
    }

    const bid = {
      id: uid("bid-"),
      cardId,
      bidderId: user.id,
      bidderName: user.displayName,
      amountCCoin: amount,
      status: "active" as const,
      createdAt: nowIso(),
      outbidAt: null,
      cancelledAt: null,
      acceptedAt: null,
    };
    store.bids.push(bid);

    // XP
    (user as unknown as Record<string, unknown>).xp = ((user as unknown as { xp: number }).xp ?? 0) + 5;
    // also mirror to totalXp
    const u = store.users.get(user.id);
    if (u) {
      u.totalXp = (u.totalXp ?? u.xp ?? 0) + 0; // hold does not add spend XP; keep level consistent
    }
    // event-driven badge eval after bid (first_bid, single_bid_gt etc)
    const { evaluateBadges } = await import("../lib/store.js");
    evaluateBadges(user.id);
    if (!store.userBadges.find((ub) => ub.userId === user.id && ub.badgeId === "b2")) {
      awardBadgeIfNeeded(user.id, "b2");
    }
    if (amount > 100 && !store.userBadges.find((ub) => ub.userId === user.id && ub.badgeId === "b5")) {
      awardBadgeIfNeeded(user.id, "b5");
    }

    return c.json({ bid, activeBid: bid }, 201);
  },
);

// POST /:id/cancel — bidder cancel own active/outbid bid (C-Coin release)
app.post("/:id/cancel", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const bid = store.bids.find((b) => b.id === c.req.param("id"));
  if (!bid) return c.json({ error: "Bid tidak ditemukan" }, 404);
  if (bid.bidderId !== user.id) return c.json({ error: "Hanya bidder pemilik yang bisa cancel" }, 403);
  if (bid.status === "accepted") return c.json({ error: "Bid sudah accepted — tidak bisa cancel" }, 400);
  if (bid.status === "cancelled") return c.json({ error: "Bid sudah cancelled" }, 400);
  const wasActive = bid.status === "active";
  bid.status = "cancelled";
  (bid as unknown as Record<string, unknown>).cancelledAt = nowIso();
  // release: if was active or outbid, funds were held; return them
  addTx(user.id, "release", bid.amountCCoin, "bid", bid.id, `Cancel bid release — ${bid.amountCCoin} C-Coin kembali`);
  // if was active, next highest outbid bid (if any) stays outbid — no auto-promote (per docs owner accept only)
  return c.json({ ok: true, bid });
});

// POST /cards/:cardId/accept — accept current active bid on card
app.post(
  "/cards/:cardId/accept",
  zValidator("json", z.object({ bidId: z.string().optional(), destination: z.enum(["buyer_address", "platform_vault"]).optional().default("buyer_address"), shippingAddress: z.string().optional(), shippingFeeCcoin: z.number().int().min(1).optional().nullable() })),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const cardId = c.req.param("cardId");
    const card = store.cards.get(cardId);
    if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
    if (card.ownerId !== user.id) return c.json({ error: "Hanya owner yang bisa accept" }, 403);
    // FINAL: tidak ada KYC untuk accept bid
    const body = c.req.valid("json") as { bidId?: string; destination?: string; shippingAddress?: string; shippingFeeCcoin?: number | null };
    let bid: typeof store.bids[number] | undefined;
    if (body.bidId) bid = store.bids.find((b) => b.id === body.bidId && b.cardId === cardId);
    else bid = store.bids.find((b) => b.cardId === cardId && b.status === "active");
    if (!bid) return c.json({ error: "Tidak ada bid active untuk card ini" }, 404);
    if (bid.status !== "active") return c.json({ error: `Bid status: ${bid.status}` }, 400);
    const price = bid.amountCCoin;
    const drop = store.drops.get(card.dropId)!;
    const { platformCcoin, royaltyCcoin, sellerCcoin } = splitSecondaryFeeCcoin(price);
    addTx(card.ownerId!, "settlement", sellerCcoin, "bid", bid.id, `Hasil bid accept 85% — ${price} C-Coin`, { fee_rate_platform: 0.075, fee_rate_royalty: 0.075, fee_rate_seller: 0.85, platformCcoin, price });
    addTx(drop.creatorId, "royalty", royaltyCcoin, "bid", bid.id, `Royalty bid 7,5% — ${drop.title}`, { fee_rate_platform: 0.075, fee_rate_royalty: 0.075, platformCcoin, price });
    bid.status = "accepted";
    bid.acceptedAt = nowIso();
    for (const other of store.bids.filter((b) => b.cardId === cardId && b.status === "active" && b.id !== bid.id)) {
      other.status = "outbid";
      other.outbidAt = nowIso();
      addTx(other.bidderId, "escrow_release", other.amountCCoin, "bid", other.id, `Outbid release`);
    }
    card.ownerId = bid.bidderId;
    card.status = "sold";
    card.buyoutPriceCcoin = null;
    store.ownershipHistory.push({ id: uid("oh-"), cardId, ownerId: bid.bidderId, acquiredVia: "secondary_bid", orderId: null, bidId: bid.id, transferredAt: nowIso() });
    // Shipment choice per Flow 7 secondary (MVP records intent only)
    return c.json({ ok: true, bid, card, needShipmentChoice: true, hint: "Pilih tujuan kirim pembeli (alamat vs vault) di langkah berikutnya." });
  },
);

export default app;
