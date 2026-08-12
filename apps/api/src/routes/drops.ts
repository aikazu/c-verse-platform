import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

app.get("/", async (c) => {
  const q = c.req.query();
  const status = q.status as string | undefined;
  const search = (q.search as string | undefined)?.toLowerCase();
  let drops = [...store.drops.values()];
  if (status && status !== "all") drops = drops.filter(d => d.status === status);
  if (search) drops = drops.filter(d => d.title.toLowerCase().includes(search) || d.series.toLowerCase().includes(search));
  // sort: live first, then scheduled, then ended
  const order: Record<string, number> = { live: 0, scheduled: 1, ended: 2, draft: 3, review: 3, approved: 3, production: 3, cancelled: 4 };
  drops.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ drops: drops.map(d => ({ ...d, remainingUnits: d.totalUnits - d.soldCount, idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR, idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR })) });
});

app.get("/:id", async (c) => {
  const d = store.drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "Drop tidak ditemukan" }, 404);
  const cards = [...store.cards.values()].filter(ca => ca.dropId === d.id);
  const soldCards = cards.filter(ca => ca.status !== "available");
  return c.json({
    ...d,
    remainingUnits: d.totalUnits - d.soldCount,
    idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
    idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
    cardsPreview: cards.slice(0, 6),
    stats: { total: cards.length, sold: soldCards.length, available: cards.filter(ca => ca.status === "available").length },
  });
});

app.post("/", zValidator("json", z.object({
  title: z.string().min(3).max(120),
  series: z.string().min(3).max(120),
  narrative: z.string().min(10).max(5000),
  artworkUrl: z.string().optional().default(""),
  totalUnits: z.number().int().min(1).max(200),
  priceUnsignedCCoin: z.number().int().min(1).default(30),
  priceSignedCCoin: z.number().int().min(1).default(50),
  dropAt: z.string().optional(),
})), async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  const user = getUserByToken(token);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.role !== "creator" && user.role !== "admin") return c.json({ error: "Hanya kreator/admin yang bisa membuat drop" }, 403);
  const body = c.req.valid("json");
  const { calcSignedCount, calcUnsignedCount } = await import("@c-verse/shared");
  const signedCount = calcSignedCount(body.totalUnits);
  const unsignedCount = calcUnsignedCount(body.totalUnits);
  const id = `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const drop = {
    id, title: body.title, series: body.series, narrative: body.narrative,
    artworkUrl: body.artworkUrl || "/textures/genesis.jpg",
    totalUnits: body.totalUnits, signedCount, unsignedCount,
    priceUnsignedCCoin: body.priceUnsignedCCoin, priceSignedCCoin: body.priceSignedCCoin,
    status: "draft" as const, dropAt: body.dropAt || null,
    creatorId: user.id, creatorName: user.displayName, soldCount: 0, createdAt: new Date().toISOString(),
  };
  store.drops.set(id, drop);
  // create cards
  for (let i = 1; i <= body.totalUnits; i++) {
    const variant = i <= signedCount ? "signed" as const : "unsigned" as const;
    const shortId = `${id.slice(0, 4)}-${String(i).padStart(3, "0")}`;
    const nfcUid = `04A1${Math.random().toString(16).slice(2, 10).padEnd(8, "0").toUpperCase()}${String(i).padStart(2, "0")}`;
    store.cards.set(`card-${id}-${String(i).padStart(2, "0")}`, {
      id: `card-${id}-${String(i).padStart(2, "0")}`, dropId: id, unitNumber: i, variant, status: "available", ownerId: null, nfcUid, nfcShortId: shortId, verifyStatus: "verified",
    });
  }
  return c.json({ drop }, 201);
});

app.patch("/:id/status", zValidator("json", z.object({ status: z.enum(["draft","review","approved","production","scheduled","live","ended","cancelled"]) })), async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  const user = getUserByToken(token);
  if (!user || user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const d = store.drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "Drop tidak ditemukan" }, 404);
  d.status = c.req.valid("json").status as typeof d.status;
  return c.json({ drop: d });
});

export default app;
