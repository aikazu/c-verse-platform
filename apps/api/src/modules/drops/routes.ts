import { AOV_UNSIGNED_CCOIN, ARTWORK_MAX_BYTES, C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, clientIp, getOptionalUser, requireAdmin, requireUser, tokenFingerprint } from "../../lib/auth.js";
import { RpcError, rpcDropEntry, userDb } from "../../lib/db.js";
import { sanitizeDbError } from "../../lib/errors.js";
import {
  buildArtworkObjectKey,
  casUpdatePublicAssetUrl,
  cleanupPublicObject,
  managedKeyFromPublicUrl,
  type PublicAssetBindings,
  parseBoundedImageForm,
  publicAssetUrl,
  UploadRequestError,
  validatePublicImage,
} from "../../lib/publicAssets.js";
import { getCreatorByUserId } from "../../lib/reads/creators.js";
import { type DropFilter, getDropById, listCardsByDrop, listDrops } from "../../lib/reads/drops.js";
import { logAuditDb } from "../../lib/reads/kyc.js";
import { getUserById, listUsersByIds } from "../../lib/reads/users.js";
import { pageMeta, parsePageParams, publicDisplayName, slicePage } from "../../lib/reads.js";
import type { Card, Drop } from "../../lib/store.js";
import { randomHex } from "../../lib/store.js";
import { getSupabase } from "../../lib/supabase.js";

const app = new Hono<{ Bindings: PublicAssetBindings }>();

// Status yang boleh dilihat publik (paritas RLS drops_select_public).
const PUBLIC_DROP_STATUSES = ["live", "published", "sold_out", "closed", "scheduled"];

interface DropWinner {
  unitNumber: number;
  variant: "signed" | "unsigned";
  displayName: string;
}

// Pemenang diekspos hanya setelah drop selesai (sudah draw / sold out / closed) —
// raffle draw maupun FCFS checkout sama-sama mengisi owner kartu, jangan bocor
// saat window raffle masih berjalan.
function isWinnersRevealed(drop: Drop): boolean {
  return drop.drawnAt != null || drop.status === "sold_out" || drop.status === "closed";
}

// Urutan tampil (docs 09 3.2 numbering economy): unit signed dulu, lalu
// unit_number ascending.
function sortByUnitDisplay<T extends { unitNumber: number; variant: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.variant !== b.variant ? (a.variant === "signed" ? -1 : 1) : a.unitNumber - b.unitNumber));
}

// Pemenang drop = kartu ber-owner (bound). Nama owner sudah dimasking
// server-side sehingga pemenang anonim/flagged tampil sebagai 'Anonim'.
async function buildDropWinners(cards: Card[]): Promise<DropWinner[]> {
  const owned = sortByUnitDisplay(cards.filter((ca) => ca.ownerId != null));
  const ownerById = new Map((await listUsersByIds(owned.map((ca) => ca.ownerId as string))).map((u) => [u.id, u]));
  return owned.map((ca) => ({
    unitNumber: ca.unitNumber,
    variant: ca.variant,
    displayName: publicDisplayName(ca.ownerId ? (ownerById.get(ca.ownerId) ?? null) : null),
  }));
}

app.get("/", async (c) => {
  const q = c.req.query();
  const status = q.status as string | undefined;
  const search = (q.search as string | undefined)?.toLowerCase();
  const authRes = await requireUser(c);
  const viewer = "error" in authRes ? null : authRes.user;

  const filter: DropFilter = {
    status,
    search,
    viewerId: viewer?.id,
    viewerRole: viewer?.role,
    publicStatuses: PUBLIC_DROP_STATUSES,
  };

  const drops = await listDrops(filter);

  // Sorting masih in-memory karena priority order complex (live→published→scheduled→...)
  const order: Record<string, number> = {
    live: 0,
    published: 0,
    scheduled: 1,
    draft: 2,
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
  // Authenticated lists can contain private drafts and must never enter shared caches.
  c.header("Cache-Control", viewer ? "private, no-store" : "public, max-age=60");
  return c.json({ drops: paged, ...pageMeta(enriched.length, page) });
});

app.get("/:id", async (c) => {
  const d = await getDropById(c.req.param("id"));
  // Lane C (remediation): status gate paritas dengan /:id/cards dan RLS
  // drops_select_public — id drop time-based mudah ditebak, draft/cancelled
  // tidak boleh readable walau id-nya ketahuan (admin memakai list endpoint).
  if (!d || !PUBLIC_DROP_STATUSES.includes(d.status)) return c.json({ error: "Drop tidak ditemukan" }, 404);
  const [cards, creatorUser, creatorRec] = await Promise.all([
    listCardsByDrop(d.id),
    getUserById(d.creatorId),
    getCreatorByUserId(d.creatorId),
  ]);
  const soldCards = cards.filter((ca) => ca.status !== "inventory");
  // Personalisasi opsional (getOptionalUser — tanpa session tetap 200): UI pakai
  // ini untuk state "sudah ikut raffle" dan menyembunyikan tombol entry ulang
  // (unique index drop_entries(drop_id, user_id) memang melarang entry kedua).
  const viewer = await getOptionalUser(c);
  let myEntry: { pool: string; holdCcoin: number; status: string } | null = null;
  if (viewer) {
    const { data: entryRow } = await getSupabase()
      .from("drop_entries")
      .select("pool, hold_ccoin, status")
      .eq("drop_id", d.id)
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (entryRow) myEntry = { pool: String(entryRow.pool), holdCcoin: Number(entryRow.hold_ccoin), status: String(entryRow.status) };
  }
  // Winners (B1): hanya dihitung (dan di-query) saat drop sudah selesai.
  const winners = isWinnersRevealed(d) ? await buildDropWinners(cards) : undefined;
  return c.json({
    ...d,
    myEntry,
    dropStartAt: d.dropStartAt,
    priceCcoin: d.priceCcoin ?? d.priceUnsignedCCoin,
    remainingUnits: d.totalUnits - d.soldCount,
    idrPrice: (d.priceCcoin ?? d.priceUnsignedCCoin) * C_COIN_RATE_IDR,
    idrUnsigned: d.priceUnsignedCCoin * C_COIN_RATE_IDR,
    idrSigned: d.priceSignedCCoin * C_COIN_RATE_IDR,
    // identitas publik kreator — link /c/:handle, jangan pernah pakai creatorId (UUID)
    creatorHandle: creatorRec?.handle ?? creatorUser?.username ?? null,
    creatorUsername: creatorUser?.username ?? null,
    // Preview ringkas: baris kartu penuh membawa nfcUid (input diversifikasi
    // kunci CMAC — docs/12), lastCtr, dan ownerId; tidak satu pun boleh publik.
    cardsPreview: cards.slice(0, 6).map((ca) => ({ id: ca.id, unitNumber: ca.unitNumber, variant: ca.variant })),
    ...(winners ? { winners } : {}),
    stats: { total: cards.length, sold: soldCards.length, available: cards.filter((ca) => ca.status === "inventory").length },
  });
});

// Daftar semua kartu per drop (B1) untuk grid publik — tanpa identitas owner;
// konsumen hanya perlu tahu unit mana yang sudah berpemilik (isOwned). Drop
// non-publik (draft/cancelled) disembunyikan selaras dengan listing.
app.get("/:id/cards", async (c) => {
  const d = await getDropById(c.req.param("id"));
  if (!d || !PUBLIC_DROP_STATUSES.includes(d.status)) return c.json({ error: "Drop tidak ditemukan" }, 404);
  const cards = await listCardsByDrop(d.id);
  return c.json({
    cards: sortByUnitDisplay(cards).map((ca) => ({
      id: ca.id,
      unitNumber: ca.unitNumber,
      variant: ca.variant,
      status: ca.status,
      isOwned: ca.ownerId != null,
    })),
  });
});

/**
 * Jadwal raffle drop (docs 03 Flow 5): rilis default HARI INI 12:00 WIB;
 * input date-only juga di-normalisasi ke 12:00 WIB. Window entry = 24 jam.
 */
function resolveDropStartAt(raw: string | undefined): string | null {
  if (!raw) {
    const now = new Date();
    const jakarta = new Date(now.getTime() + 7 * 3600 * 1000);
    jakarta.setUTCHours(12, 0, 0, 0);
    return jakarta.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00+07:00`;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

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
      dropStartAt: z.string().optional(),
      dropEndAt: z.string().optional(),
      // Drops are administered by ops, but their creator attribution must be
      // explicit so revenue, royalties, and creator analytics reach the
      // recruited creator instead of the admin operating the dashboard.
      creatorId: z.string().uuid(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    // Founder 2026-08-29: pembuatan drop murni wewenang admin (docs 03 ADM-02) —
    // dashboard kreator read-only analytics, tidak ada self-serve drop.
    if (user.role !== "admin") return c.json({ error: "Hanya admin yang bisa membuat drop" }, 403);
    const body = c.req.valid("json");
    const db = getSupabase();
    const { data: creatorRecord, error: creatorError } = await db
      .from("creators")
      .select("user_id,status")
      .eq("user_id", body.creatorId)
      .maybeSingle();
    if (creatorError) return c.json({ error: sanitizeDbError(creatorError) }, 400);
    if (creatorRecord?.status !== "active") return c.json({ error: "Kreator aktif tidak ditemukan" }, 422);

    const { data: creatorUser, error: creatorUserError } = await db
      .from("users")
      .select("id,display_name,role,flag_reason")
      .eq("id", body.creatorId)
      .maybeSingle();
    if (creatorUserError) return c.json({ error: sanitizeDbError(creatorUserError) }, 400);
    if (creatorUser?.role !== "creator" || creatorUser.flag_reason) {
      return c.json({ error: "Kreator aktif tidak ditemukan" }, 422);
    }
    const { calcSignedCount, calcUnsignedCount, calcSignedPrice } = await import("@c-verse/shared");
    const signedCount = calcSignedCount(body.totalUnits);
    const unsignedCount = calcUnsignedCount(body.totalUnits);
    // docs/01 + 05-data-model: drop adalah platform-produced (70/30) dengan SATU harga canonical priceCcoin
    const priceCcoin = body.priceCcoin ?? body.priceCCoin ?? body.priceUnsignedCCoin ?? AOV_UNSIGNED_CCOIN;
    const priceUnsigned = body.priceUnsignedCCoin ?? priceCcoin;
    // Founder 2026-08-16: signed = unsigned + 20 C-Coin flat (20/40, 40/60, 50/70)
    const priceSigned = body.priceSignedCCoin ?? calcSignedPrice(priceCcoin);
    const dropStartAt = resolveDropStartAt(body.dropStartAt);
    if (!dropStartAt) return c.json({ error: "dropStartAt tidak valid" }, 400);
    // Drop selalu raffle: window entry 24 jam sejak rilis, draw otomatis via cron (docs 03 Flow 5)
    const raffleEndAt = new Date(new Date(dropStartAt).getTime() + 24 * 3600 * 1000).toISOString();
    const id = `drop-${Date.now().toString(36)}-${randomHex(3)}`;
    const { error: dropError } = await db.from("drops").insert({
      id,
      title: body.title,
      series: body.series,
      narrative: body.narrative,
      artwork_url: body.artworkUrl || "/mock/v1/artworks/genesis.png",
      artwork_3d_url: body.artwork3dUrl || null,
      total_units: body.totalUnits,
      signed_count: signedCount,
      unsigned_count: unsignedCount,
      price_unsigned_ccoin: priceUnsigned,
      price_signed_ccoin: priceSigned,
      price_ccoin: priceCcoin,
      status: "draft",
      drop_start_at: dropStartAt,
      raffle_end_at: raffleEndAt,
      drop_end_at: body.dropEndAt ?? null,
      creator_id: creatorUser.id,
      creator_name: creatorUser.display_name,
      created_by: user.id,
    });
    if (dropError) {
      console.error("[drops] insert drops gagal:", dropError.message);
      return c.json({ error: sanitizeDbError(dropError) }, 400);
    }

    // Short id unik per drop: prefix hex acak (pola nfc_uid). Slice(0,4) lama
    // selalu "drop" sehingga drop kedua menabrak unique index
    // cards_nfc_short_id_key dengan drop-001… (e2e bug 2026-08-29).
    const nfcShortIdPrefix = randomHex(3).toUpperCase();
    const cardRows = Array.from({ length: body.totalUnits }, (_, i) => {
      const unit = i + 1;
      return {
        id: `card-${id}-${String(unit).padStart(2, "0")}`,
        drop_id: id,
        unit_number: unit,
        variant: unit <= signedCount ? "signed" : "unsigned",
        status: "inventory",
        location: "platform_stock",
        buyout_price_ccoin: null,
        nfc_configured: false,
        qc_status: "pending",
        owner_id: null,
        // 7-byte UID (14 hex): fixed prefix + 4 crypto-random bytes + unit tail
        nfc_uid: `04A1${randomHex(4).toUpperCase()}${String(unit).padStart(2, "0")}`,
        nfc_short_id: `${nfcShortIdPrefix}-${String(unit).padStart(3, "0")}`,
        // 'verified' HANYA via tap CMAC — kartu baru belum terverifikasi (docs 12)
        verify_status: "unknown",
        last_ctr: 0,
      };
    });
    const { error: cardsError } = await db.from("cards").insert(cardRows);
    if (cardsError) {
      console.error("[drops] insert cards gagal:", cardsError.message);
      return c.json({ error: sanitizeDbError(cardsError) }, 400);
    }

    await logAuditDb(
      user.id,
      "create",
      "drops",
      id,
      { title: body.title, dropStartAt, raffleEndAt },
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );
    const drop = await getDropById(id);
    return c.json({ drop }, 201);
  },
);

// Founder 2026-08-29: transisi status drop (publish/cancel) HANYA admin —
// sama dengan pembuatan drop (docs 03 ADM-02). scheduled -> live tetap otomatis
// cron activate_scheduled_drops saat drop_start_at tiba.

app.post("/:id/artwork", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const error = adminGateError(authRes);
    return c.json(error.body, error.status);
  }
  const bucket = c.env.ASSETS;
  if (!bucket) return c.json({ error: "Public asset storage belum terkonfigurasi" }, 503);

  const drop = await getDropById(c.req.param("id"));
  if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);

  let file: File;
  try {
    file = await parseBoundedImageForm(c.req.raw, ARTWORK_MAX_BYTES);
  } catch (error) {
    if (error instanceof UploadRequestError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "Form upload tidak valid" }, 400);
  }

  let image: Awaited<ReturnType<typeof validatePublicImage>>;
  try {
    image = await validatePublicImage(file, ARTWORK_MAX_BYTES);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "File gambar tidak valid" }, 400);
  }

  let key: string;
  try {
    key = buildArtworkObjectKey(drop.id, image.extension);
  } catch {
    return c.json({ error: "Drop ID tidak valid untuk penyimpanan artwork" }, 400);
  }
  const previousUrl = drop.artworkUrl || null;
  const artworkUrl = publicAssetUrl(c.req.url, c.env, key);
  let uploaded: R2Object | null;
  try {
    uploaded = await bucket.put(key, image.buffer, {
      httpMetadata: {
        contentType: image.contentType,
        contentDisposition: `inline; filename="artwork.${image.extension}"`,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { kind: "artwork", dropId: drop.id, width: String(image.width), height: String(image.height) },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "artwork_put_failed", key, error: error instanceof Error ? error.message : String(error) }));
    await cleanupPublicObject(bucket, key, "artwork_put_cleanup_failed");
    return c.json({ error: "Upload artwork gagal" }, 503);
  }
  if (!uploaded) {
    await cleanupPublicObject(bucket, key, "artwork_empty_put_cleanup_failed");
    return c.json({ error: "Upload artwork gagal" }, 503);
  }

  const outcome = await casUpdatePublicAssetUrl(getSupabase(), {
    table: "drops",
    idColumn: "id",
    id: drop.id,
    urlColumn: "artwork_url",
    previousUrl,
    newUrl: artworkUrl,
  });
  if (outcome === "ambiguous") {
    return c.json({ error: "Status penyimpanan artwork belum dapat dipastikan — coba muat ulang drop" }, 503);
  }
  if (outcome === "not_committed") {
    await cleanupPublicObject(bucket, key, "artwork_cas_cleanup_failed");
    return c.json({ error: "Artwork berubah oleh permintaan lain — coba lagi" }, 409);
  }

  const oldKey = managedKeyFromPublicUrl(c.req.url, c.env, previousUrl, { kind: "artwork", dropId: drop.id });
  if (oldKey && oldKey !== key) await cleanupPublicObject(bucket, oldKey, "artwork_old_object_cleanup_failed");
  try {
    const sessionId = await tokenFingerprint(c.req.header("authorization"));
    await logAuditDb(
      authRes.user.id,
      "update",
      "drops",
      drop.id,
      { operation: "update_artwork", artworkUrl, previousArtworkUrl: previousUrl },
      clientIp(c),
      sessionId,
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "artwork_audit_failed", dropId: drop.id, error: String(error) }));
  }
  return c.json({ artworkUrl });
});

app.patch(
  "/:id/status",
  zValidator(
    "json",
    z.object({
      status: z.enum(["draft", "scheduled", "published", "live", "sold_out", "closed", "cancelled"]),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const status = c.req.valid("json").status;
    const drop = await getDropById(c.req.param("id"));
    if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);
    if (user.role !== "admin") return c.json({ error: "Hanya admin yang bisa mengubah status drop" }, 403);
    const db = getSupabase();
    const { data, error } = await db.from("drops").update({ status }).eq("id", c.req.param("id")).select().maybeSingle();
    if (error) return c.json({ error: sanitizeDbError(error) }, 400);
    if (!data) return c.json({ error: "Drop tidak ditemukan" }, 404);
    await logAuditDb(
      user.id,
      "update",
      "drops",
      String(data.id),
      { status, prevStatus: drop.status },
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );
    const updated = await getDropById(String(data.id));
    return c.json({ drop: updated });
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
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("draw_drop", { p_drop_id: c.req.param("id") });
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  return c.json({ winners: data });
});
