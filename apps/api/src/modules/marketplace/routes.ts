import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../lib/auth.js";
import { RpcError, rpcBuyoutCard, rpcSetBuyout, userDb } from "../../lib/db.js";
import { listDrops } from "../../lib/reads/drops.js";
import { listUsersByIds } from "../../lib/reads/users.js";
import { isPubliclyMasked, pageMeta, parsePageParams, publicDisplayName, slicePage } from "../../lib/reads.js";
import type { Drop, User } from "../../lib/store.js";
import { listMarketplaceCards } from "./reads.js";

// Marketplace = buyout langsung di kartu (C-07 FINAL — legacy auction/listing dihapus, spec 16 F-02).

const app = new Hono();

// GET / — kartu dengan harga buyout aktif
app.get("/", async (c) => {
  const q = c.req.query();
  const search = q.search?.toLowerCase();
  const mine = q.mine === "1";

  const dropById = new Map<string, Drop>((await listDrops()).map((d) => [d.id, d]));
  let cards = await listMarketplaceCards();
  if (search) {
    cards = cards.filter((ca) => {
      const drop = dropById.get(ca.dropId);
      const title = drop?.title.toLowerCase().includes(search) ?? false;
      const series = drop?.series.toLowerCase().includes(search) ?? false;
      return title || series || ca.nfcShortId.toLowerCase().includes(search);
    });
  }
  if (mine) {
    // Lane C: filter milik-sendiri WAJIB terautentikasi — fallback diam-diam ke
    // list publik menyesatkan pemilik (billing/privasi), 401 eksplisit.
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    cards = cards.filter((ca) => ca.ownerId === authRes.user.id);
  }

  const sellerIds = [...new Set(cards.map((ca) => ca.ownerId).filter((id): id is string => id != null))];
  const sellerById = new Map<string, User>((await listUsersByIds(sellerIds)).map((u) => [u.id, u]));

  const marketplace = cards
    .sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0))
    .map((card) => {
      const drop = dropById.get(card.dropId);
      const seller = card.ownerId ? (sellerById.get(card.ownerId) ?? null) : null;
      return {
        kind: "buyout" as const,
        // Lane C: kartu publik diproyeksi minimal (yang dirender UI) — baris
        // penuh membawa ownerId/nfcUid (input kunci CMAC)/lastCtr/location.
        card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant },
        drop: drop
          ? {
              id: drop.id,
              title: drop.title,
              series: drop.series,
              artworkUrl: drop.artworkUrl,
              creatorName: drop.creatorName,
              isSeed: drop.isSeed,
            }
          : null,
        // Privacy (A3) + lane C: seller anon/suspended → 'Anonim' tanpa
        // username; UUID seller tidak pernah keluar di payload publik.
        seller: seller
          ? {
              displayName: publicDisplayName(seller),
              username: isPubliclyMasked(seller) ? null : (seller.username ?? null),
            }
          : null,
        buyoutPriceCcoin: card.buyoutPriceCcoin,
        idrPrice: (card.buyoutPriceCcoin ?? 0) * C_COIN_RATE_IDR,
      };
    });

  const page = parsePageParams(c.req.query());
  const paged = slicePage(marketplace, page);
  return c.json({ marketplace: paged, cards: paged, listings: [], enriched: paged, ...pageMeta(marketplace.length, page) });
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
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const raw = c.req.valid("json");
    const price = raw.buyoutPriceCcoin ?? raw.priceCCoin;
    if (price == null) return c.json({ error: "buyoutPriceCcoin wajib (integer ≥ 1)" }, 400);

    const db = userDb(authRes.token);
    try {
      const card = await rpcSetBuyout(db, raw.cardId, price);
      return c.json({ card, buyoutPriceCcoin: price, dbPath: "rpc" }, 201);
    } catch (err) {
      if (err instanceof RpcError) return c.json({ error: err.message, code: err.code }, err.code === "FORBIDDEN" ? 403 : 400);
      throw err;
    }
  },
);

// POST /buyout — beli kartu di harga buyout (fee 7,5/7,5/85 via RPC).
// dest buyer_address -> wajib alamat; RPC membuat shipment 'requested' otomatis.
app.post(
  "/buyout",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1),
      destination: z.enum(["buyer_address", "platform_vault"]).default("buyer_address"),
      shippingAddress: z.string().min(10).max(500).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const { cardId, destination, shippingAddress } = c.req.valid("json");
    if (destination === "buyer_address" && !shippingAddress) {
      return c.json({ error: "Alamat pengiriman wajib (min 10 karakter) untuk kirim fisik" }, 400);
    }
    const db = userDb(authRes.token);
    try {
      const card = await rpcBuyoutCard(db, cardId, destination, shippingAddress ?? null);
      return c.json({ ok: true, card, dbPath: "rpc" }, 201);
    } catch (err) {
      if (err instanceof RpcError) {
        const status =
          err.code === "INSUFFICIENT"
            ? 402
            : ["FORBIDDEN", "OWN_CARD", "COOLING_PERIOD_24H", "CREATOR_SELF_DEALING_30D", "CARD_NOT_TRADABLE"].includes(err.code)
              ? 403
              : ["ADDRESS_REQUIRED", "NOT_FOR_SALE"].includes(err.code)
                ? 400
                : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  },
);

// PATCH /cards/:id/buyout — ubah/hapus harga buyout
app.patch("/cards/:id/buyout", zValidator("json", z.object({ buyoutPriceCcoin: z.number().int().min(1).nullable() })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { buyoutPriceCcoin } = c.req.valid("json");
  const db = userDb(authRes.token);
  try {
    const card = await rpcSetBuyout(db, c.req.param("id"), buyoutPriceCcoin);
    return c.json({ card });
  } catch (err) {
    if (err instanceof RpcError) return c.json({ error: err.message, code: err.code }, err.code === "FORBIDDEN" ? 403 : 400);
    throw err;
  }
});

// DELETE /:cardId — cabut buyout (by card id)
app.delete("/:id", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const db = userDb(authRes.token);
  try {
    const card = await rpcSetBuyout(db, c.req.param("id"), null);
    return c.json({ ok: true, card });
  } catch (err) {
    if (err instanceof RpcError) return c.json({ error: err.message, code: err.code }, err.code === "FORBIDDEN" ? 403 : 400);
    throw err;
  }
});

export default app;
