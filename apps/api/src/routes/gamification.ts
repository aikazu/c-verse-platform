import { Hono } from "hono";
import { store, ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

app.get("/leaderboard", async (c) => {
  const limit = Math.min(50, Math.max(5, Number(c.req.query("limit") || 20)));
  const users = [...store.users.values()].sort((a,b)=> b.xp - a.xp).slice(0, limit);
  const { calcLevel } = await import("@c-verse/shared");
  const board = users.map((u, idx) => {
    const { level, tier } = calcLevel(u.xp);
    const cards = [...store.cards.values()].filter(ca => ca.ownerId === u.id).length;
    const w = store.wallets.get(u.id);
    return { rank: idx+1, userId: u.id, displayName: u.displayName, level, tier, xp: u.xp, totalCards: cards, totalSpentCCoin: w?.totalSpentCCoin ?? 0 };
  });
  return c.json({ leaderboard: board });
});

app.get("/badges", async (c) => {
  return c.json({ badges: store.badges });
});

app.get("/badges/:userId", async (c) => {
  const ub = store.userBadges.filter(x => x.userId === c.req.param("userId")).map(x => {
    const def = store.badges.find(b=> b.id===x.badgeId);
    return { ...x, badge: def };
  });
  return c.json({ badges: ub });
});

export default app;
