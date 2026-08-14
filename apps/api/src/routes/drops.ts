import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, logAudit } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";
import type { DropStatus } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

app.get("/", async (c) => {
  const q = c.req.query();
  const status = q.status as string | undefined;
  const search = (q.search as string | undefined)?.toLowerCase();
  let drops = [...store.drops.values()];
  if (status && status !== "all") drops = drops.filter((d) => d.status === status);
  if (search) drops = drops.filter((d) => d.title.toLowerCase().includes(search) || d.series.toLowerCase().includes(search) || d.creatorName.toLowerCase().includes(search));
  const order: Record<string, number> = { live: 0, published: 0, scheduled: 1, draft: 2, review: 2, approved: 2, production: 2, ended: 3, sold_out: 3, closed: 4, cancelled: 4 };
  drops.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({
    drops: drops.map((d) => ({
      ...d,
      remainingUnits: d.totalUnits - d.soldCount,
      idrPrice: (d.priceCcoin ?? d.priceUnsignedCCoin) * C_COIN_RATE_IDR,
      idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
      idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
    })),
  });
});

app.get("/:id", async (c) => {
  const d = store.drops.get(c.req.param("id"));
  if (!d) return c.json({ error: "Drop tidak ditemukan" }, 404);
  const cards = [...store.cards.values()].filter((ca) => ca.dropId === d.id);
  const soldCards = cards.filter((ca) => ca.status !== "available");
  return c.json({
    ...d,
    dropStartAt: d.dropStartAt ?? d.dropAt,
    priceCcoin: d.priceCcoin ?? d.priceUnsignedCCoin,
    remainingUnits: d.totalUnits - d.soldCount,
    idrPrice: (d.priceCcoin ?? d.priceUnsignedCCoin) * C_COIN_RATE_IDR,
    idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
    idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
    cardsPreview: cards.slice(0, 6),
    stats: { total: cards.length, sold: soldCards.length, available: cards.filter((ca) => ca.status === "available").length },
  });
});

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      title: z.string().min(3).max(120),
      series: z.string().min(3).max(120),
      narrative: z.string().min(10).max(5000),
      artworkUrl: z.string().optional().default(""),
      artwork3dUrl: z.string().optional().default(""),
      totalUnits: z.number().int().min(1).max(1000),
      priceCCoin: z.number().int().min(1).optional(),
      priceCcoin: z.number().int().min(1).optional(),
      priceUnsignedCCoin: z.number().int().min(1).optional(),
      priceSignedCCoin: z.number().int().min(1).optional(),
      dropAt: z.string().optional(),
      dropStartAt: z.string().optional(),
      dropEndAt: z.string().optional(),
      creatorId: z.string().optional(),
    }),
  ),
  async (c) => {
    const token = authHeaderToToken(c.req.header("authorization"));
    const user = getUserByToken(token);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if ((user.role as string) !== "creator" && (user.role as string) !== "admin") return c.json({ error: "Hanya kreator/admin yang bisa membuat drop" }, 403);
    const body = c.req.valid("json");
    const { calcSignedCount, calcUnsignedCount } = await import("@c-verse/shared");
    const signedCount = calcSignedCount(body.totalUnits);
    const unsignedCount = calcUnsignedCount(body.totalUnits);
    // docs/01 + 05-data-model: drop adalah platform-produced (70/30) dengan SATU harga canonical priceCcoin
    const priceCcoin = body.priceCcoin ?? body.priceCCoin ?? body.priceUnsignedCCoin ?? 30;
    const priceUnsigned = body.priceUnsignedCCoin ?? priceCcoin;
    const priceSigned = body.priceSignedCCoin ?? Math.ceil(priceCcoin * 1.6);
    // Canonical status per docs/05-data-model drops.status = draft/scheduled/published/live/sold_out/closed/cancelled
    const allowedStatuses: DropStatus[] = ["draft", "scheduled", "published", "live", "sold_out", "closed", "cancelled"];
    const legacyMap: Record<string, DropStatus> = { review: "draft", approved: "scheduled", production: "scheduled", ended: "closed" };
    const id = `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const dropStartAt = body.dropStartAt ?? body.dropAt ?? null;
    const drop = {
      id,
      title: body.title,
      series: body.series,
      narrative: body.narrative,
      artworkUrl: body.artworkUrl || "/textures/genesis.jpg",
      artwork3dUrl: (body as unknown as { artwork3dUrl?: string }).artwork3dUrl || null,
      totalUnits: body.totalUnits,
      signedCount,
      unsignedCount,
      priceUnsignedCCoin: priceUnsigned,
      priceSignedCCoin: priceSigned,
      priceCcoin: priceCcoin,
      status: "draft" as const,
      dropAt: dropStartAt,
      dropStartAt,
      dropEndAt: body.dropEndAt ?? null,
      creatorId: user.id,
      creatorName: user.displayName,
      soldCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };
    store.drops.set(id, drop);
    for (let i = 1; i <= body.totalUnits; i++) {
      const variant = i <= signedCount ? ("signed" as const) : ("unsigned" as const);
      const shortId = `${id.slice(0, 4)}-${String(i).padStart(3, "0")}`;
      const nfcUid = `04A1${Math.random().toString(16).slice(2, 10).padEnd(8, "0").toUpperCase()}${String(i).padStart(2, "0")}`;
      const cardId = `card-${id}-${String(i).padStart(2, "0")}`;
      store.cards.set(cardId, {
        id: cardId,
        dropId: id,
        unitNumber: i,
        variant,
        status: "available",
        location: "platform_stock",
        buyoutPriceCcoin: null,
        nfcConfigured: false,
        qcStatus: "pending",
        ownerId: null,
        nfcUid,
        nfcShortId: shortId,
        verifyStatus: "verified",
      });
    }
    logAudit(user.id, "create", "drops", id, { title: body.title }, c.req.header("x-forwarded-for") ?? null, token ?? null);
    return c.json({ drop }, 201);
  },
);

app.patch(
  "/:id/status",
  zValidator("json", z.object({ status: z.enum(["draft", "scheduled", "published", "live", "sold_out", "closed", "cancelled", "review", "approved", "production", "ended"]) })),
  async (c) => {
    const token = authHeaderToToken(c.req.header("authorization"));
    const user = getUserByToken(token);
    if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const d = store.drops.get(c.req.param("id"));
    if (!d) return c.json({ error: "Drop tidak ditemukan" }, 404);
    d.status = c.req.valid("json").status as typeof d.status;
    logAudit(user.id, "update", "drops", d.id, { status: d.status }, c.req.header("x-forwarded-for") ?? null, token ?? null);
    return c.json({ drop: d });
  },
);

export default app;
