import { calcLevel } from "@c-verse/shared";
import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { countCardsByOwner, listBadges, listTopUsersByXp, listUserBadges } from "../lib/reads/gamification.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { readDb } from "../lib/reads.js";

const app = new Hono();

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

// PATCH /badges/:id — admin toggle badge availability (ADM-07)
app.patch("/badges/:id", async (c) => {
  const authRes = await requireUser(c);
  const user = "error" in authRes ? null : authRes.user;
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  let body: { isActive?: boolean } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {}
  if (typeof body.isActive !== "boolean") return c.json({ error: "isActive (boolean) wajib" }, 400);
  const db = readDb();
  const { data, error } = await db.from("badges").update({ is_active: body.isActive }).eq("id", c.req.param("id")).select().maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  if (!data) return c.json({ error: "Badge tidak ditemukan" }, 404);
  await logAuditDb(
    user.id,
    "update",
    "badges",
    String(data.id),
    { isActive: body.isActive },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ badge: data });
});

export default app;
