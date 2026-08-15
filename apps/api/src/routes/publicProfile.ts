import { Hono } from "hono";
import { listCards, listDrops } from "../lib/reads/drops.js";
import { getUserByUsernameOrId, getUserRank, listUserBadges } from "../lib/reads/profiles.js";
import type { Drop } from "../lib/store.js";
import { ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// GET /u/:username — public collector profile (koleksi/level/badge/ranking) — hidden if isAnonymous
app.get("/u/:username", async (c) => {
  const raw = c.req.param("username");
  const user = await getUserByUsernameOrId(raw);
  if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
  if (user.isAnonymous) {
    return c.json({
      user: { id: user.id, displayName: user.displayName, username: user.username ?? null, isAnonymous: true },
      hidden: true,
    });
  }
  const totalXp = user.totalXp ?? user.xp ?? 0;
  const { calcLevel } = await import("@c-verse/shared");
  const { level, tier } = calcLevel(totalXp);
  const progressInLevel = totalXp % 10;
  const levelProgressPct = Math.round((progressInLevel / 10) * 100);
  const [drops, myCards, badges, rank] = await Promise.all([
    listDrops(),
    listCards({ ownerId: user.id }),
    listUserBadges(user.id),
    getUserRank(user.id, totalXp),
  ]);
  const dropById = new Map<string, Drop>(drops.map((d) => [d.id, d]));
  const cards = myCards.map((ca) => {
    const drop = dropById.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series } : null };
  });
  return c.json({
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      level,
      tier,
      levelProgressPct,
      rank,
    },
    cards,
    badges,
    stats: { totalCards: cards.length },
  });
});

export default app;
