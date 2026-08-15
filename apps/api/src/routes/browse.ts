import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { Hono } from "hono";
import { listBids, listBidsByCard } from "../lib/reads/bids.js";
import { getCardByIdOrNfc, getDropById, listCards, listDrops } from "../lib/reads/drops.js";
import { listUsersByIds } from "../lib/reads/users.js";
import type { Bid, Drop, User } from "../lib/store.js";
import { ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// Browse (docs 02 PG-BROWSE-01): search by kartu/kreator, bid langsung walau tanpa buyout price
app.get("/", async (c) => {
  const q = (c.req.query("q") ?? c.req.query("search") ?? "").toLowerCase().trim();
  const creatorFilter = (c.req.query("creator") ?? "").toLowerCase().trim();
  // For browse we show bound cards (owned), including those without buyout (can still bid)
  let cards = (await listCards()).filter((ca) => ca.ownerId != null);

  const dropById = new Map<string, Drop>((await listDrops()).map((d) => [d.id, d]));
  if (q) {
    cards = cards.filter((ca) => {
      const drop = dropById.get(ca.dropId);
      const hay = `${ca.nfcShortId} ${drop?.title ?? ""} ${drop?.series ?? ""} ${drop?.creatorName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (creatorFilter) {
    cards = cards.filter((ca) => {
      const drop = dropById.get(ca.dropId);
      return (
        (drop?.creatorName.toLowerCase().includes(creatorFilter) ?? false) ||
        (drop?.creatorId.toLowerCase().includes(creatorFilter) ?? false)
      );
    });
  }

  // Numbering economy (docs 09 3.2): allow sort by unit_number for secondary Browse — pagination-friendly sort
  const sortBy = (c.req.query("sort") ?? "").toLowerCase();
  const order = (c.req.query("order") ?? "asc").toLowerCase();
  if (sortBy === "unit_number" || sortBy === "unit") {
    cards.sort((a, b) => (order === "desc" ? b.unitNumber - a.unitNumber : a.unitNumber - b.unitNumber));
  } else {
    cards.sort((a, b) => a.nfcShortId.localeCompare(b.nfcShortId));
  }

  const ownerIds = [...new Set(cards.map((ca) => ca.ownerId).filter((id): id is string => id != null))];
  const ownerById = new Map<string, User>((await listUsersByIds(ownerIds)).map((u) => [u.id, u]));
  const activeBidByCard = new Map<string, Bid>();
  for (const b of await listBids({ status: "active" })) {
    if (!activeBidByCard.has(b.cardId)) activeBidByCard.set(b.cardId, b);
  }

  const enriched = cards.map((card) => {
    const drop = dropById.get(card.dropId);
    const owner = card.ownerId ? ownerById.get(card.ownerId) : null;
    return {
      card: {
        id: card.id,
        nfcShortId: card.nfcShortId,
        unitNumber: card.unitNumber,
        variant: card.variant,
        status: card.status,
        location: card.location,
        buyoutPriceCcoin: card.buyoutPriceCcoin,
        ownerId: card.ownerId,
      },
      drop: drop
        ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, creatorName: drop.creatorName }
        : null,
      owner: owner ? { id: owner.id, displayName: owner.displayName } : null,
      buyoutIdr: card.buyoutPriceCcoin != null ? card.buyoutPriceCcoin * C_COIN_RATE_IDR : null,
      activeBid: activeBidByCard.get(card.id) ?? null,
      canBid: true,
    };
  });

  return c.json({ cards: enriched, results: enriched });
});

// GET /cards/:id — single card browse detail (same as nfc /cards/:id but via browse mount for convenience)
app.get("/cards/:id", async (c) => {
  const card = await getCardByIdOrNfc(c.req.param("id"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const drop = await getDropById(card.dropId);
  const owner = card.ownerId ? ((await listUsersByIds([card.ownerId]))[0] ?? null) : null;
  const bids = (await listBidsByCard(card.id)).sort((a, b) => b.amountCCoin - a.amountCCoin);
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  return c.json({ card, drop, owner: owner ? { id: owner.id, displayName: owner.displayName } : null, activeBid, bids: bids.slice(0, 20) });
});

export default app;
