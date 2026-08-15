import { calcLevel } from "@c-verse/shared";
import { Hono } from "hono";
import { countCardsByOwner, listBadges, listTopUsersByXp, listUserBadges } from "../lib/reads/gamification.js";
import { ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

app.get("/leaderboard", async (c) => {
  const limit = Math.min(50, Math.max(5, Number(c.req.query("limit") || 20)));
  const users = await listTopUsersByXp(limit);
  const cardCounts = await countCardsByOwner(users.map((u) => u.id));
  const board = users.map((u, idx) => {
    const xp = u.totalXp ?? u.xp ?? 0;
    const { level, tier } = calcLevel(xp);
    return {
      rank: idx + 1,
      userId: u.id,
      displayName: u.displayName,
      username: u.username ?? null,
      level,
      tier,
      totalCards: cardCounts.get(u.id) ?? 0,
    };
  });
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ leaderboard: board });
});

app.get("/badges", async (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return c.json({ badges: await listBadges() });
});

app.get("/badges/:userId", async (c) => {
  return c.json({ badges: await listUserBadges(c.req.param("userId")) });
});

export default app;
