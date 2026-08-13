import { Hono } from "hono";
import { store, ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

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

// GET /:id — creator by userId or handle or creator rec id; includes published/live drops only for public
app.get("/:id", async (c) => {
  const raw = c.req.param("id");
  // resolve handle first, then user id / creator rec id
  const recByHandle = [...store.creators.values()].find((cr) => cr.handle.toLowerCase() === raw.toLowerCase());
  let user = recByHandle ? store.users.get(recByHandle.userId!) ?? null : store.users.get(raw) ?? null;
  if (!user && recByHandle) user = store.users.get(recByHandle.userId!) ?? null;
  // also allow lookup via username
  if (!user) user = [...store.users.values()].find((u) => ((u as unknown as { username?: string }).username ?? "").toLowerCase() === raw.toLowerCase()) ?? null;
  if (!user || (user.role as string) !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  const rec = [...store.creators.values()].find((cr) => cr.userId === user!.id) ?? null;
  const drops = [...store.drops.values()]
    .filter((d) => d.creatorId === user!.id && ["published", "live", "sold_out", "scheduled", "ended", "closed"].includes(d.status))
    .sort((a, b) => new Date((b as unknown as { dropStartAt?: string | null }).dropStartAt ?? (b as unknown as { dropAt: string | null }).dropAt ?? b.createdAt).getTime() - new Date((a as unknown as { dropStartAt?: string | null }).dropStartAt ?? (a as unknown as { dropAt: string | null }).dropAt ?? a.createdAt).getTime());
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
  const user = store.users.get(rec.userId!) ?? null;
  if (!user) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const drops = [...store.drops.values()].filter((d) => d.creatorId === user.id);
  return c.json({ creator: { id: user.id, displayName: user.displayName, handle: rec.handle }, drops, rec });
});

export default app;
