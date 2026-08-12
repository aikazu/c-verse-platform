import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet, addTx, uid, nowIso } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) {
  const token = authHeaderToToken(c.req.header("authorization"));
  return getUserByToken(token);
}

// List orders for current user
app.get("/", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const orders = [...store.orders.values()].filter(o => o.userId === user.id).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return c.json({ orders });
});

app.get("/:id", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const o = store.orders.get(c.req.param("id"));
  if (!o) return c.json({ error: "Order tidak ditemukan" }, 404);
  if (o.userId !== user.id && user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  const drop = store.drops.get(o.dropId);
  const cards = o.cardIds.map(id => store.cards.get(id)).filter(Boolean);
  return c.json({ order: o, drop, cards });
});

// Checkout (primary sale) — potong saldo C-Coin (medium tunggal)
app.post("/checkout", zValidator("json", z.object({
  dropId: z.string().min(1),
  quantity: z.number().int().min(1).max(2).default(1),
  variant: z.enum(["unsigned","signed"]).default("unsigned"),
  shippingAddress: z.string().min(10).max(500),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { dropId, quantity, variant, shippingAddress } = c.req.valid("json");
  const drop = store.drops.get(dropId);
  if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);
  if (drop.status !== "live") return c.json({ error: `Drop belum live (status: ${drop.status})` }, 400);
  const available = [...store.cards.values()].filter(ca => ca.dropId === dropId && ca.status === "available" && ca.variant === variant);
  if (available.length < quantity) return c.json({ error: `Stok ${variant} tidak cukup. Sisa: ${available.length}` }, 400);
  const pricePer = variant === "signed" ? drop.priceSignedCCoin : drop.priceUnsignedCCoin;
  const totalCCoin = pricePer * quantity;
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < totalCCoin) {
    return c.json({ error: "Saldo C-Coin tidak cukup", needCCoin: totalCCoin, haveCCoin: w.balanceCCoin, needIdr: totalCCoin * C_COIN_RATE_IDR, topupHint: `Top-up minimal ${totalCCoin - w.balanceCCoin} C-Coin` }, 402);
  }
  // Enforce limit 2 per user per drop
  const userOrdersForDrop = [...store.orders.values()].filter(o => o.userId === user.id && o.dropId === dropId);
  const userQty = userOrdersForDrop.reduce((n,o)=> n + o.cardIds.length, 0);
  if (userQty + quantity > 2) return c.json({ error: "Limit max 2 kartu per user per drop" }, 400);

  // Allocate cards atomically
  const allocated = available.slice(0, quantity);
  for (const ca of allocated) { ca.status = "sold"; ca.ownerId = user.id; }
  drop.soldCount += quantity;
  if (drop.soldCount >= drop.totalUnits) drop.status = "ended";

  // Deduct wallet
  addTx(user.id, "checkout", -totalCCoin, "order", `chk-${Date.now()}`, `Checkout ${quantity}x ${variant} @ ${drop.title} — ${totalCCoin} C-Coin`);
  user.xp += quantity * 50;

  // Creator revenue share (70/30 or 30/70) — credit creator wallet as C-Coin hold (disburse on settlement)
  const creatorSharePct = 0.3; // platform-produced default 30% to creator
  const creatorCCoin = Math.floor(totalCCoin * creatorSharePct);
  if (creatorCCoin > 0) {
    ensureWallet(drop.creatorId);
    addTx(drop.creatorId, "royalty", creatorCCoin, "order", `roy-${Date.now()}`, `Revenue share ${creatorSharePct*100}% dari ${drop.title}`);
    const creator = store.users.get(drop.creatorId);
    if (creator) creator.xp += 20;
  }

  // Create order
  const orderId = uid("ord-");
  const order = {
    id: orderId, userId: user.id, dropId, cardIds: allocated.map(ca=> ca.id),
    totalCCoin, totalIdr: totalCCoin * C_COIN_RATE_IDR, status: "paid" as const,
    shippingAddress, trackingNumber: `JNE-${Math.floor(Math.random()*1e12).toString().padStart(12,"0")}`,
    createdAt: nowIso(), deliveredAt: null,
  };
  store.orders.set(orderId, order);

  // Badge: first_drop
  if (!store.userBadges.find(ub => ub.userId === user.id && ub.badgeId === "b1")) {
    store.userBadges.push({ userId: user.id, badgeId: "b1", earnedAt: nowIso() });
    user.xp += 100;
  }

  return c.json({ order, cards: allocated, wallet: { ...ensureWallet(user.id), balanceIdrEquiv: ensureWallet(user.id).balanceCCoin * C_COIN_RATE_IDR } }, 201);
});

app.post("/:id/confirm-delivered", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const o = store.orders.get(c.req.param("id"));
  if (!o || o.userId !== user.id) return c.json({ error: "Order tidak ditemukan" }, 404);
  o.status = "delivered";
  o.deliveredAt = nowIso();
  return c.json({ order: o });
});

export default app;
