import { calcLevel, type LeaderboardEntry, type LeaderboardType, leaderboardQuerySchema } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { adminGateError, clientIp, requireAdmin, tokenFingerprint } from "../lib/auth.js";
import { sanitizeDbError } from "../lib/errors.js";
import { listBadges, listLeaderboard, listUserBadges } from "../lib/reads/gamification.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { getUserById } from "../lib/reads/users.js";
import { readDb } from "../lib/reads.js";

const app = new Hono();

// Cache-Control per type: xp is the global default (more stable), the per-collection
// boards (cards/badges/creator) are scoped to a single user/creator so we cache shorter.
const CACHE_CONTROL_BY_TYPE: Record<LeaderboardType, string> = {
  xp: "public, max-age=60",
  cards: "public, max-age=30",
  badges: "public, max-age=30",
  creator: "public, max-age=30",
};

app.get("/leaderboard", zValidator("query", leaderboardQuerySchema), async (c) => {
  const { type, creatorId, limit } = c.req.valid("query");
  // Creator gate — only fire when the caller asks for a per-creator board.
  // Reuse the same resolution rule as /api/creators/:id (users.role=creator + not suspended).
  if (type === "creator") {
    if (!creatorId) return c.json({ error: "creatorId wajib untuk type=creator" }, 400);
    const creator = await getUserById(creatorId);
    if (creator?.role !== "creator" || creator.flagReason) {
      return c.json({ error: "Creator tidak ditemukan" }, 404);
    }
  }
  const rows = await listLeaderboard(type, creatorId ?? null, limit);
  const board: LeaderboardEntry[] = rows.map((r) => {
    const { level, tier } = calcLevel(r.totalXp);
    return {
      rank: r.rank,
      userId: r.userId,
      displayName: r.displayName,
      username: r.username,
      avatarUrl: r.avatarUrl,
      totalXp: r.totalXp,
      level,
      tier,
      score: r.score,
      reachedAt: r.reachedAt,
    };
  });
  c.header("Cache-Control", CACHE_CONTROL_BY_TYPE[type]);
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
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
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
