import { Hono } from "hono";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) { return getUserByToken(authHeaderToToken(c.req.header("authorization"))); }

app.get("/", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const myCards = [...store.cards.values()].filter(ca => ca.ownerId === user.id);
  const myOrders = [...store.orders.values()].filter(o => o.userId === user.id);
  const myListings = [...store.listings.values()].filter(l => l.sellerId === user.id);
  const enrichedCards = myCards.map(ca => {
    const drop = store.drops.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null };
  });
  const wallet = ensureWallet(user.id);
  const badges = store.userBadges.filter(ub => ub.userId === user.id).map(ub => {
    const def = store.badges.find(b => b.id === ub.badgeId);
    return { ...ub, badge: def };
  });
  const kyc = [...store.kyc.values()].find(k => k.userId === user.id);
  // level
  const { calcLevel } = await import("@c-verse/shared");
  const { level, tier } = calcLevel(user.xp);
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, xp: user.xp, level, tier },
    wallet: { ...wallet, balanceIdrEquiv: wallet.balanceCCoin * C_COIN_RATE_IDR },
    cards: enrichedCards,
    orders: myOrders,
    listings: myListings,
    badges,
    kyc: kyc || null,
    stats: { totalCards: myCards.length, totalOrders: myOrders.length, activeListings: myListings.filter(l=> ["listed","bidding"].includes(l.status)).length },
  });
});

app.get("/cards", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const myCards = [...store.cards.values()].filter(ca => ca.ownerId === user.id).map(ca => {
    const drop = store.drops.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null };
  });
  return c.json({ cards: myCards });
});

export default app;
