import { calcLevel } from "@c-verse/shared";
import { Hono } from "hono";
import { adminGateError, clientIp, requireAdmin, tokenFingerprint } from "../lib/auth.js";
import { countCardsByOwner, listBadges, listTopUsersByXp, listUserBadges } from "../lib/reads/gamification.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { getUserById } from "../lib/reads/users.js";
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
  // Hormati privasi: user is_anonymous menyembunyikan koleksi/level/badge (sama seperti profil publik).
  const target = await getUserById(c.req.param("userId"));
  if (!target || target.isAnonymous || target.flagReason) return c.json({ badges: [] });
  return c.json({ badges: await listUserBadges(c.req.param("userId")) });
});

// PATCH /badges/:id — admin toggle badge availability (ADM-07)
app.patch("/badges/:id", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const user = authRes.user;
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
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ badge: data });
});

export default app;
