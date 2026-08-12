import { Hono } from "hono";
import { store, ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

app.get("/", async (c) => {
  const creators = [...store.users.values()].filter(u => u.role === "creator").map(u => {
    const drops = [...store.drops.values()].filter(d => d.creatorId === u.id);
    const totalSold = drops.reduce((n,d)=> n + d.soldCount, 0);
    const totalUnits = drops.reduce((n,d)=> n + d.totalUnits, 0);
    return { id: u.id, displayName: u.displayName, email: u.email, xp: u.xp, stats: { drops: drops.length, totalSold, totalUnits } };
  });
  return c.json({ creators });
});

app.get("/:id", async (c) => {
  const u = store.users.get(c.req.param("id"));
  if (!u || u.role !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  const drops = [...store.drops.values()].filter(d => d.creatorId === u.id);
  return c.json({ creator: { id: u.id, displayName: u.displayName, xp: u.xp }, drops });
});

export default app;
