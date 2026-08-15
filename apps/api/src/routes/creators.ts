import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import {
  getCreatorByHandle,
  getCreatorByUserId,
  listCreatorPageViews,
  listCreators,
  listCreatorUsers,
  recordCreatorPageView,
} from "../lib/reads/creators.js";
import { listDrops } from "../lib/reads/drops.js";
import { getUserByUsernameOrId } from "../lib/reads/profiles.js";
import { getUserById } from "../lib/reads/users.js";
import type { CreatorRec } from "../lib/store.js";
import { ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// GET / — list public creators (derived from users.role=creator + creators table for handle/followers)
app.get("/", async (c) => {
  const [creatorUsers, recs, drops] = await Promise.all([listCreatorUsers(), listCreators(), listDrops()]);
  const recByUserId = new Map<string, CreatorRec>(recs.filter((cr) => cr.userId != null).map((cr) => [cr.userId as string, cr]));
  const creators = creatorUsers.map((u) => {
    const rec = recByUserId.get(u.id) ?? null;
    const myDrops = drops.filter((d) => d.creatorId === u.id);
    const totalSold = myDrops.reduce((n, d) => n + d.soldCount, 0);
    const totalUnits = myDrops.reduce((n, d) => n + d.totalUnits, 0);
    return {
      id: u.id,
      displayName: u.displayName,
      username: u.username ?? null,
      handle: rec?.handle ?? null,
      totalFollowersCombined: rec?.totalFollowersCombined ?? null,
      xp: u.totalXp ?? u.xp ?? 0,
      stats: { drops: myDrops.length, totalSold, totalUnits },
    };
  });
  return c.json({ creators });
});

// Helper: log creator page view (docs 05 creator_page_views + 09 3.5 log from day 1)
async function logCreatorView(creatorUserId: string, c: { req: { header: (k: string) => string | undefined } }) {
  const rec = await getCreatorByUserId(creatorUserId);
  if (!rec) return;
  const referrer = c.req.header("referer") ?? c.req.header("referrer") ?? null;
  // city anonymized from header — MVP uses x-forwarded-for stub, not real geo
  const city = c.req.header("x-city") ?? null;
  const viewerRes = await requireUser(c);
  const viewer = "error" in viewerRes ? null : viewerRes.user;
  recordCreatorPageView({ creatorId: rec.id, referrer, city, userId: viewer?.id ?? null });
}

// GET /:id — creator by userId or handle or creator rec id; includes published/live drops only for public
app.get("/:id", async (c) => {
  const raw = c.req.param("id");
  // resolve handle first, then user id / username
  const recByHandle = await getCreatorByHandle(raw);
  let user = recByHandle?.userId ? await getUserById(recByHandle.userId) : null;
  if (!user && !recByHandle) user = await getUserByUsernameOrId(raw);
  if (!user || (user.role as string) !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  const rec = await getCreatorByUserId(user.id);
  await logCreatorView(user.id, c);
  const drops = (await listDrops())
    .filter((d) => d.creatorId === user?.id && ["published", "live", "sold_out", "scheduled", "ended", "closed"].includes(d.status))
    .sort(
      (a, b) => new Date(b.dropStartAt ?? b.dropAt ?? b.createdAt).getTime() - new Date(a.dropStartAt ?? a.dropAt ?? a.createdAt).getTime(),
    );
  const wantStats = c.req.query("stats") === "1" || c.req.query("includeStats") === "1";
  if (wantStats && rec) {
    const views = await listCreatorPageViews(rec.id);
    const totalViews = views.length;
    const uniqueViewers = new Set(views.filter((v) => v.userId).map((v) => v.userId)).size;
    const refMap: Record<string, number> = {};
    for (const v of views)
      if (v.referrer) {
        try {
          const h = new URL(v.referrer).hostname;
          refMap[h] = (refMap[h] ?? 0) + 1;
        } catch {
          refMap[v.referrer] = (refMap[v.referrer] ?? 0) + 1;
        }
      }
    const topReferrer = Object.entries(refMap).sort((a, b) => b[1] - a[1])[0] ?? null;
    return c.json({
      creator: {
        id: user.id,
        displayName: user.displayName,
        username: user.username ?? null,
        handle: rec?.handle ?? null,
        totalFollowersCombined: rec?.totalFollowersCombined ?? null,
        xp: user.totalXp ?? user.xp ?? 0,
      },
      drops,
      stats: { totalViews, uniqueViewers, topReferrer: topReferrer ? { domain: topReferrer[0], count: topReferrer[1] } : null },
    });
  }
  return c.json({
    creator: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      handle: rec?.handle ?? null,
      totalFollowersCombined: rec?.totalFollowersCombined ?? null,
      xp: user.totalXp ?? user.xp ?? 0,
    },
    drops,
  });
});

// GET /handle/:handle — explicit handle route (for /c/:username frontend)
app.get("/handle/:handle", async (c) => {
  const rec = await getCreatorByHandle(c.req.param("handle"));
  if (!rec) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const user = rec.userId ? await getUserById(rec.userId) : null;
  if (!user) return c.json({ error: "Creator tidak ditemukan" }, 404);
  await logCreatorView(user.id, c);
  const drops = (await listDrops()).filter((d) => d.creatorId === user.id);
  return c.json({ creator: { id: user.id, displayName: user.displayName, handle: rec.handle }, drops, rec });
});

export default app;
