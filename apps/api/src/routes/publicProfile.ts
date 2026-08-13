import { Hono } from "hono";
import { store, ensureSeed, getUserByToken, authHeaderToToken } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

// GET /u/:username — public collector profile (koleksi/level/badge/ranking) — hidden if isAnonymous
app.get("/u/:username", async (c) => {
  const raw = c.req.param("username");
  const user = [...store.users.values()].find((u) => ((u as unknown as { username?: string }).username ?? "").toLowerCase() === raw.toLowerCase() || u.id === raw);
  if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
  if ((user as unknown as { isAnonymous?: boolean }).isAnonymous) {
    return c.json({ user: { id: user.id, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null, isAnonymous: true }, hidden: true });
  }
  const totalXp = (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0;
  const { calcLevel } = await import("@c-verse/shared");
  const { level, tier } = calcLevel(totalXp);
  const cards = [...store.cards.values()].filter((ca) => ca.ownerId === user.id).map((ca) => {
    const drop = store.drops.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series } : null };
  });
  const badges = store.userBadges.filter((ub) => ub.userId === user.id).map((ub) => {
    const def = store.badges.find((b) => b.id === ub.badgeId);
    return { ...ub, badge: def };
  });
  const rank =
    [...store.users.values()].sort((a, b) => ((b as unknown as { totalXp?: number }).totalXp ?? (b as unknown as { xp: number }).xp) - ((a as unknown as { totalXp?: number }).totalXp ?? (a as unknown as { xp: number }).xp)).findIndex((u) => u.id === user.id) + 1;
  return c.json({
    user: { id: user.id, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null, level, tier, xp: totalXp, rank },
    cards,
    badges,
    stats: { totalCards: cards.length },
  });
});

export default app;
