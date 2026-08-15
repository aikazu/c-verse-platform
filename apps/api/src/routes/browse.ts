import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { Hono } from "hono";
import { ensureSeed, store } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// Browse (docs 02 PG-BROWSE-01): search by kartu/kreator, bid langsung walau tanpa buyout price
app.get("/", async (c) => {
  const q = (c.req.query("q") ?? c.req.query("search") ?? "").toLowerCase().trim();
  const creatorFilter = (c.req.query("creator") ?? "").toLowerCase().trim();
  let cards = [...store.cards.values()].filter(
    (ca) => ca.status !== "available" || ca.ownerId != null || ca.buyoutPriceCcoin != null || true,
  );
  // For browse we show bound cards (owned), including those without buyout (can still bid)
  cards = [...store.cards.values()].filter((ca) => ca.ownerId != null);

  if (q) {
    cards = cards.filter((ca) => {
      const drop = store.drops.get(ca.dropId);
      const hay = `${ca.nfcShortId} ${drop?.title ?? ""} ${drop?.series ?? ""} ${drop?.creatorName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (creatorFilter) {
    cards = cards.filter((ca) => {
      const drop = store.drops.get(ca.dropId);
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

  const enriched = cards.map((card) => {
    const drop = store.drops.get(card.dropId);
    const owner = card.ownerId ? store.users.get(card.ownerId) : null;
    const activeBid = store.bids.find((b) => b.cardId === card.id && b.status === "active") ?? null;
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
      activeBid,
      canBid: true,
    };
  });

  return c.json({ cards: enriched, results: enriched });
});

// GET /cards/:id — single card browse detail (same as nfc /cards/:id but via browse mount for convenience)
app.get("/cards/:id", async (c) => {
  const card = store.cards.get(c.req.param("id")) ?? [...store.cards.values()].find((ca) => ca.nfcShortId === c.req.param("id")) ?? null;
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  const bids = store.bids.filter((b) => b.cardId === card.id).sort((a, b) => b.amountCCoin - a.amountCCoin);
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  return c.json({ card, drop, owner: owner ? { id: owner.id, displayName: owner.displayName } : null, activeBid, bids: bids.slice(0, 20) });
});

export default app;
