import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { RpcError, rpcDropEntry, userDb } from "../lib/db.js";
import { getCreatorByUserId } from "../lib/reads/creators.js";
import { getDropById, listCardsByDrop, listDrops } from "../lib/reads/drops.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { pageMeta, parsePageParams, slicePage } from "../lib/reads.js";
import { getUserById } from "../lib/reads/users.js";
import { getSupabase } from "../lib/supabase.js";
import type { DropStatus } from "../lib/store.js";

const app = new Hono();

app.get("/", async (c) => {
  const q = c.req.query();
  const status = q.status as string | undefined;
  const search = (q.search as string | undefined)?.toLowerCase();
  let drops = await listDrops();
  if (status && status !== "all") drops = drops.filter((d) => d.status === status);
  if (search)
    drops = drops.filter(
      (d) =>
        d.title.toLowerCase().includes(search) || d.series.toLowerCase().includes(search) || d.creatorName.toLowerCase().includes(search),
    );
  const order: Record<string, number> = {
    live: 0,
    published: 0,
    scheduled: 1,
    draft: 2,
    review: 2,
    approved: 2,
    production: 2,
    ended: 3,
    sold_out: 3,
    closed: 4,
    cancelled: 4,
  };
  drops.sort(
    (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const enriched = drops.map((d) => ({
    ...d,
    remainingUnits: d.totalUnits - d.soldCount,
    idrPrice: (d.priceCcoin ?? d.priceUnsignedCCoin) * C_COIN_RATE_IDR,
    idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
    idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
  }));
  const page = parsePageParams(c.req.query());
  const paged = slicePage(enriched, page);
  // data publik yang jarang berubah — cache edge/browser 60 detik
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ drops: paged, ...pageMeta(enriched.length, page) });
});

app.get("/:id", async (c) => {
  const d = await getDropById(c.req.param("id"));
  if (!d) return c.json({ error: "Drop tidak ditemukan" }, 404);
  const [cards, creatorUser, creatorRec] = await Promise.all([
    listCardsByDrop(d.id),
    getUserById(d.creatorId),
    getCreatorByUserId(d.creatorId),
  ]);
  const soldCards = cards.filter((ca) => ca.status !== "available");
  return c.json({
    ...d,
    dropStartAt: d.dropStartAt ?? d.dropAt,
    priceCcoin: d.priceCcoin ?? d.priceUnsignedCCoin,
    remainingUnits: d.totalUnits - d.soldCount,
    idrPrice: (d.priceCcoin ?? d.priceUnsignedCCoin) * C_COIN_RATE_IDR,
    idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
    idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
    // identitas publik kreator — link /c/:handle, jangan pernah pakai creatorId (UUID)
    creatorHandle: creatorRec?.handle ?? creatorUser?.username ?? null,
    creatorUsername: creatorUser?.username ?? null,
    cardsPreview: cards.slice(0, 6),
    stats: { total: cards.length, sold: soldCards.length, available: cards.filter((ca) => ca.status === "available").length },
  });
});

const LEGACY_STATUS_MAP: Record<string, DropStatus> = { review: "draft", approved: "scheduled", production: "scheduled", ended: "closed" };

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
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    if (user.role !== "creator" && user.role !== "admin") return c.json({ error: "Hanya kreator/admin yang bisa membuat drop" }, 403);
    const body = c.req.valid("json");
    const { calcSignedCount, calcUnsignedCount } = await import("@c-verse/shared");
    const signedCount = calcSignedCount(body.totalUnits);
    const unsignedCount = calcUnsignedCount(body.totalUnits);
    // docs/01 + 05-data-model: drop adalah platform-produced (70/30) dengan SATU harga canonical priceCcoin
    const priceCcoin = body.priceCcoin ?? body.priceCCoin ?? body.priceUnsignedCCoin ?? 30;
    const priceUnsigned = body.priceUnsignedCCoin ?? priceCcoin;
    const priceSigned = body.priceSignedCCoin ?? Math.ceil(priceCcoin * 1.67); // docs 01 F004 / 09 2.7: signed = 1.67× base (20→34, 30→50, 50→84 ceil)
    const id = `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const dropStartAt = body.dropStartAt ?? body.dropAt ?? null;
    const db = getSupabase();
    const { error: dropError } = await db.from("drops").insert({
      id,
      title: body.title,
      series: body.series,
      narrative: body.narrative,
      artwork_url: body.artworkUrl || "/textures/genesis.jpg",
      artwork_3d_url: body.artwork3dUrl || null,
      total_units: body.totalUnits,
      signed_count: signedCount,
      unsigned_count: unsignedCount,
      price_unsigned_ccoin: priceUnsigned,
      price_signed_ccoin: priceSigned,
      price_ccoin: priceCcoin,
      status: "draft",
      drop_at: dropStartAt,
      drop_start_at: dropStartAt,
      drop_end_at: body.dropEndAt ?? null,
      creator_id: user.id,
      creator_name: user.displayName,
      created_by: user.id,
    });
    if (dropError) return c.json({ error: dropError.message }, 400);

    const cardRows = Array.from({ length: body.totalUnits }, (_, i) => {
      const unit = i + 1;
      return {
        id: `card-${id}-${String(unit).padStart(2, "0")}`,
        drop_id: id,
        unit_number: unit,
        variant: unit <= signedCount ? "signed" : "unsigned",
        status: "available",
        location: "platform_stock",
        buyout_price_ccoin: null,
        nfc_configured: false,
        qc_status: "pending",
        owner_id: null,
        nfc_uid: `04A1${Math.random().toString(16).slice(2, 10).padEnd(8, "0").toUpperCase()}${String(unit).padStart(2, "0")}`,
        nfc_short_id: `${id.slice(0, 4)}-${String(unit).padStart(3, "0")}`,
        verify_status: "verified",
        last_ctr: 0,
      };
    });
    const { error: cardsError } = await db.from("cards").insert(cardRows);
    if (cardsError) return c.json({ error: cardsError.message }, 400);

    await logAuditDb(
      user.id,
      "create",
      "drops",
      id,
      { title: body.title },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    const drop = await getDropById(id);
    return c.json({ drop }, 201);
  },
);

app.patch(
  "/:id/status",
  zValidator(
    "json",
    z.object({
      status: z.enum([
        "draft",
        "scheduled",
        "published",
        "live",
        "sold_out",
        "closed",
        "cancelled",
        "review",
        "approved",
        "production",
        "ended",
      ]),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    if (user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const raw = c.req.valid("json").status;
    const status = LEGACY_STATUS_MAP[raw] ?? raw;
    const db = getSupabase();
    const { data, error } = await db.from("drops").update({ status }).eq("id", c.req.param("id")).select().maybeSingle();
    if (error) return c.json({ error: error.message }, 400);
    if (!data) return c.json({ error: "Drop tidak ditemukan" }, 404);
    await logAuditDb(
      user.id,
      "update",
      "drops",
      String(data.id),
      { status },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    const drop = await getDropById(String(data.id));
    return c.json({ drop });
  },
);

export default app;

// ── Raffle (C-15 hybrid, docs/13 §2.1b) ──────────────────────────────────────
app.post("/:id/entry", zValidator("json", z.object({ pool: z.enum(["regular", "premium", "both"]) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { pool } = c.req.valid("json");
  const db = userDb(authRes.token);
  try {
    const entry = await rpcDropEntry(db, c.req.param("id"), pool);
    return c.json({ entry }, 201);
  } catch (err) {
    if (err instanceof RpcError) {
      const status = err.code === "INSUFFICIENT" ? 402 : err.code === "AUTH_REQUIRED" ? 401 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
});

// Draw raffle (admin/cron) — idempotent via drops.drawn_at
app.post("/:id/draw", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  if (authRes.user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("draw_drop", { p_drop_id: c.req.param("id") });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ winners: data });
});
