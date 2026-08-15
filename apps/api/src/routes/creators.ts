import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { ensureSeed, nowIso, store, uid } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// GET / — list public creators (derived from users.role=creator + creators table for handle/followers)
app.get("/", async (c) => {
  const creators = [...store.users.values()]
    .filter((u) => (u.role as string) === "creator")
    .map((u) => {
      const rec = [...store.creators.values()].find((cr) => cr.userId === u.id) ?? null;
      const drops = [...store.drops.values()].filter((d) => d.creatorId === u.id);
      const totalSold = drops.reduce((n, d) => n + d.soldCount, 0);
      const totalUnits = drops.reduce((n, d) => n + d.totalUnits, 0);
      return {
        id: u.id,
        displayName: u.displayName,
        username: (u as unknown as { username?: string }).username ?? null,
        handle: rec?.handle ?? null,
        totalFollowersCombined: rec?.totalFollowersCombined ?? null,
        xp: (u as unknown as { totalXp?: number }).totalXp ?? (u as unknown as { xp?: number }).xp ?? 0,
        stats: { drops: drops.length, totalSold, totalUnits },
      };
    });
  return c.json({ creators });
});

// Helper: log creator page view (docs 05 creator_page_views + 09 3.5 log from day 1)
async function logCreatorView(creatorUserId: string, c: { req: { header: (k: string) => string | undefined } }) {
  const rec = [...store.creators.values()].find((cr) => cr.userId === creatorUserId) ?? null;
  if (!rec) return;
  const referrer = c.req.header("referer") ?? c.req.header("referrer") ?? null;
  // city anonymized from header — MVP uses x-forwarded-for stub, not real geo
  const city = (c.req.header("x-city") as string) ?? null;
  const viewerRes = await requireUser(c);
  const viewer = "error" in viewerRes ? null : viewerRes.user;
  store.creatorPageViews.push({ id: uid("cpv-"), creatorId: rec.id, viewedAt: nowIso(), referrer, city, userId: viewer?.id ?? null });
  // guard Y1 <10k/day — simple cap 50k in-memory (avoid unbounded growth)
  if (store.creatorPageViews.length > 50000) store.creatorPageViews.splice(0, 10000);
}

// GET /:id — creator by userId or handle or creator rec id; includes published/live drops only for public
app.get("/:id", async (c) => {
  const raw = c.req.param("id");
  // resolve handle first, then user id / creator rec id
  const recByHandle = [...store.creators.values()].find((cr) => cr.handle.toLowerCase() === raw.toLowerCase());
  let user = recByHandle?.userId ? (store.users.get(recByHandle.userId) ?? null) : (store.users.get(raw) ?? null);
  if (!user && recByHandle?.userId) user = store.users.get(recByHandle.userId) ?? null;
  // also allow lookup via username
  if (!user)
    user =
      [...store.users.values()].find((u) => ((u as unknown as { username?: string }).username ?? "").toLowerCase() === raw.toLowerCase()) ??
      null;
  if (!user || (user.role as string) !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  const rec = [...store.creators.values()].find((cr) => cr.userId === user?.id) ?? null;
  await logCreatorView(user.id, c);
  const drops = [...store.drops.values()]
    .filter((d) => d.creatorId === user?.id && ["published", "live", "sold_out", "scheduled", "ended", "closed"].includes(d.status))
    .sort(
      (a, b) =>
        new Date(
          (b as unknown as { dropStartAt?: string | null }).dropStartAt ??
            (b as unknown as { dropAt: string | null }).dropAt ??
            b.createdAt,
        ).getTime() -
        new Date(
          (a as unknown as { dropStartAt?: string | null }).dropStartAt ??
            (a as unknown as { dropAt: string | null }).dropAt ??
            a.createdAt,
        ).getTime(),
    );
  const wantStats = c.req.query("stats") === "1" || c.req.query("includeStats") === "1";
  if (wantStats && rec) {
    const views = store.creatorPageViews.filter((v) => v.creatorId === rec.id);
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
        username: (user as unknown as { username?: string }).username ?? null,
        handle: rec?.handle ?? null,
        totalFollowersCombined: rec?.totalFollowersCombined ?? null,
        xp: (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0,
      },
      drops,
      stats: { totalViews, uniqueViewers, topReferrer: topReferrer ? { domain: topReferrer[0], count: topReferrer[1] } : null },
    });
  }
  return c.json({
    creator: {
      id: user.id,
      displayName: user.displayName,
      username: (user as unknown as { username?: string }).username ?? null,
      handle: rec?.handle ?? null,
      totalFollowersCombined: rec?.totalFollowersCombined ?? null,
      xp: (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0,
    },
    drops,
  });
});

// GET /handle/:handle — explicit handle route (for /c/:username frontend)
app.get("/handle/:handle", async (c) => {
  const rec = [...store.creators.values()].find((cr) => cr.handle.toLowerCase() === c.req.param("handle").toLowerCase());
  if (!rec) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const user = rec.userId ? (store.users.get(rec.userId) ?? null) : null;
  if (!user) return c.json({ error: "Creator tidak ditemukan" }, 404);
  await logCreatorView(user.id, c);
  const drops = [...store.drops.values()].filter((d) => d.creatorId === user.id);
  return c.json({ creator: { id: user.id, displayName: user.displayName, handle: rec.handle }, drops, rec });
});

export default app;
