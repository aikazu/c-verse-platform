import { Hono } from "hono";
import { clientIp, requireUser } from "../lib/auth.js";
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

const app = new Hono();

// M4 (audit 2026-08-24): RLS `creator_page_views_insert with check (true)` allows any
// anonymous insert. Without a per-IP rate limit, a botnet can pollute analytics + bloat
// storage. Simple sliding-window in-memory limiter scoped per IP+creator — Workers
// isolates share state per request, but each isolate independently caps its own
// load; the cap is intentionally low (10/min/IP/creator) to bound worst-case.
const VIEW_WINDOW_MS = 60 * 1000;
const VIEW_MAX_PER_IP = 10;
const viewBuckets = new Map<string, number[]>();

function ipRateAllow(ip: string, creatorId: string): boolean {
  const key = `${ip}|${creatorId}`;
  const now = Date.now();
  const cutoff = now - VIEW_WINDOW_MS;
  const bucket = viewBuckets.get(key) ?? [];
  const pruned = bucket.filter((ts) => ts >= cutoff);
  if (pruned.length >= VIEW_MAX_PER_IP) {
    viewBuckets.set(key, pruned);
    return false;
  }
  pruned.push(now);
  viewBuckets.set(key, pruned);
  return true;
}

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
// rec diteruskan dari caller — hindari query getCreatorByUserId ganda per request.
async function logCreatorView(creatorUserId: string, c: { req: { header: (k: string) => string | undefined } }, rec: CreatorRec | null) {
  const resolved = rec ?? (await getCreatorByUserId(creatorUserId));
  if (!resolved) return;
  // M4 per-IP rate limit (audit 2026-08-24): skip analytics when over the window
  // rather than 429 — page rendering must not break, just stop counting the spammer.
  const ip = clientIp(c) ?? "unknown";
  if (!ipRateAllow(ip, resolved.id)) return;
  const referrer = c.req.header("referer") ?? c.req.header("referrer") ?? null;
  // city anonymized from header — MVP uses x-forwarded-for stub, not real geo
  const city = c.req.header("x-city") ?? null;
  const viewerRes = await requireUser(c);
  const viewer = "error" in viewerRes ? null : viewerRes.user;
  recordCreatorPageView({ creatorId: resolved.id, referrer, city, userId: viewer?.id ?? null });
}

// GET /:id — creator by userId or handle or creator rec id; includes published/live drops only for public
app.get("/:id", async (c) => {
  const raw = c.req.param("id");
  // resolve handle first, then user id / username
  const recByHandle = await getCreatorByHandle(raw);
  let user = recByHandle?.userId ? await getUserById(recByHandle.userId) : null;
  if (!user && !recByHandle) user = await getUserByUsernameOrId(raw);
  if (!user || (user.role as string) !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  if (user.flagReason) return c.json({ error: "Creator tidak ditemukan" }, 404); // suspended: sembunyikan storefront
  const [rec] = await Promise.all([getCreatorByUserId(user.id), logCreatorView(user.id, c, recByHandle)]);
  const drops = (await listDrops())
    .filter((d) => d.creatorId === user?.id && ["published", "live", "sold_out", "scheduled", "closed"].includes(d.status))
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
// HANYA field publik — bank_account/notes TIDAK ikut respons (PII leak fix 2026-08-16).
app.get("/handle/:handle", async (c) => {
  const rec = await getCreatorByHandle(c.req.param("handle"));
  if (!rec) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const user = rec.userId ? await getUserById(rec.userId) : null;
  if (!user) return c.json({ error: "Creator tidak ditemukan" }, 404);
  if (user.flagReason) return c.json({ error: "Creator tidak ditemukan" }, 404);
  await logCreatorView(user.id, c, rec);
  const drops = (await listDrops()).filter((d) => d.creatorId === user.id);
  return c.json({
    creator: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      handle: rec.handle,
      bio: null,
      links: [],
      totalFollowersCombined: rec.totalFollowersCombined ?? null,
      xp: user.totalXp ?? user.xp ?? 0,
    },
    drops,
  });
});

// POST /apply — user minta jadi creator (row creators status 'inactive' menunggu
// approval admin; role di-flip admin via PATCH /api/admin/users/:id).
app.post("/apply", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  if ((user.role as string) === "creator") return c.json({ error: "Kamu sudah terdaftar sebagai kreator" }, 400);
  const username = user.username;
  if (!username) return c.json({ error: "Set username dulu di profil sebelum mendaftar kreator" }, 400);
  const existing = await getCreatorByUserId(user.id);
  if (existing) return c.json({ error: "Pendaftaran kreator sudah ada — menunggu review admin" }, 409);
  const { getSupabase } = await import("../lib/supabase.js");
  const { uid } = await import("../lib/store.js");
  const db = getSupabase();
  const id = uid("cr-");
  const { error } = await db.from("creators").insert({
    id,
    user_id: user.id,
    handle: username,
    total_followers_combined: 0,
    status: "inactive",
  });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ creator: { id, handle: username, status: "inactive", message: "Pendaftaran diterima — menunggu review admin" } }, 201);
});

export default app;
