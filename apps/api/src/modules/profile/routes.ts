import { AVATAR_MAX_BYTES, C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../lib/auth.js";
import {
  buildAvatarObjectKey,
  casUpdatePublicAssetUrl,
  cleanupPublicObject,
  managedKeyFromPublicUrl,
  type PublicAssetBindings,
  parseBoundedImageForm,
  publicAssetUrl,
  UploadRequestError,
  validatePublicImage,
} from "../../lib/publicAssets.js";
import { listBids } from "../../lib/reads/bids.js";
import { listCards, listDrops } from "../../lib/reads/drops.js";
import { getKycByUser } from "../../lib/reads/kyc.js";
import { listOrdersByUser, listShipmentsByRequester } from "../../lib/reads/orders.js";
import { getWalletByUser, listUserBadges } from "../../lib/reads/profile.js";
import { getUserByUsername } from "../../lib/reads/users.js";
import { readDb } from "../../lib/reads.js";
import { redactKycForOwner } from "../../lib/redact.js";
import type { Bid } from "../../lib/store.js";

const app = new Hono<{ Bindings: PublicAssetBindings }>();

// GET / — my profile, cards, orders, shipments, badges, kyc, level
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const [myCards, myOrders, myShipments, bidList, drops, activeBids] = await Promise.all([
    listCards({ ownerId: user.id }),
    listOrdersByUser(user.id),
    listShipmentsByRequester(user.id),
    listBids({ bidderId: user.id }),
    listDrops(),
    listBids({ status: "active" }),
  ]);
  const myBids = bidList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const dropById = new Map(drops.map((d) => [d.id, d]));
  const activeBidByCard = new Map<string, Bid>();
  for (const b of activeBids) {
    if (!activeBidByCard.has(b.cardId)) activeBidByCard.set(b.cardId, b);
  }
  const enrichedCards = myCards.map((ca) => {
    const drop = dropById.get(ca.dropId);
    return {
      ...ca,
      drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, isSeed: drop.isSeed } : null,
      activeBid: activeBidByCard.get(ca.id) ?? null,
    };
  });
  const wallet = await getWalletByUser(user.id);
  const badges = await listUserBadges(user.id);
  const kyc = await getKycByUser(user.id);
  const totalXp = (user as unknown as { totalXp?: number }).totalXp ?? 0;
  const { calcLevel } = await import("@c-verse/shared");
  const { level, tier } = calcLevel(totalXp);
  // For profile bar per doc: per 10 XP = 1 level. Progress within current level as 0..9 -> bar 0..90%.
  const progressInLevel = totalXp % 10; // 0..9
  const levelProgressPct = Math.round((progressInLevel / 10) * 100); // 0,10..90
  const levelProgressLabel = `Level ${level} — ${progressInLevel}/10 menuju level ${level + 1}`;
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      username: (user as unknown as { username?: string }).username ?? null,
      role: user.role,
      level,
      tier,
      levelProgressPct,
      levelProgressLabel,
      isAnonymous: (user as unknown as { isAnonymous?: boolean }).isAnonymous ?? false,
      consentAnalyticsDetail: (user as unknown as { consentAnalyticsDetail?: boolean }).consentAnalyticsDetail ?? false,
      consentDataMarket: (user as unknown as { consentDataMarket?: boolean }).consentDataMarket ?? false,
    },
    wallet: { ...wallet, balanceIdrEquiv: wallet.balanceCCoin * C_COIN_RATE_IDR },
    cards: enrichedCards,
    orders: myOrders,
    shipments: myShipments,
    bids: myBids,
    badges,
    // Audit batch 2 F6: row KYC di endpoint ini dulu membeberkan NIK penuh +
    // address. Paritas dengan GET /api/kyc — PII lewat redactKycForOwner.
    kyc: kyc ? redactKycForOwner(kyc) : null,
    stats: {
      totalCards: myCards.length,
      vaultCards: myCards.filter((ca) => ca.location === "platform_vault").length,
      withOwnerCards: myCards.filter((ca) => ca.location === "with_owner").length,
      buyoutListed: myCards.filter((ca) => ca.buyoutPriceCcoin != null).length,
      totalOrders: myOrders.length,
    },
  });
});

// POST /avatar — immutable R2 object + CAS users.avatar_url update. The URL in
// the authenticated DB row is only a comparison value; it is never trusted as
// an object key unless it parses back to this user's managed namespace.
app.post("/avatar", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const bucket = c.env.ASSETS;
  if (!bucket) return c.json({ error: "Public asset storage belum terkonfigurasi" }, 503);

  let file: File;
  try {
    file = await parseBoundedImageForm(c.req.raw, AVATAR_MAX_BYTES);
  } catch (error) {
    if (error instanceof UploadRequestError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "Form upload tidak valid" }, 400);
  }

  let image: Awaited<ReturnType<typeof validatePublicImage>>;
  try {
    image = await validatePublicImage(file, AVATAR_MAX_BYTES);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "File gambar tidak valid" }, 400);
  }

  const previousUrl = authRes.user.avatarUrl ?? null;
  const key = buildAvatarObjectKey(authRes.user.id, image.extension);
  const avatarUrl = publicAssetUrl(c.req.url, c.env, key);
  let uploaded: R2Object | null;
  try {
    uploaded = await bucket.put(key, image.buffer, {
      httpMetadata: {
        contentType: image.contentType,
        contentDisposition: `inline; filename="avatar.${image.extension}"`,
        cacheControl: "no-store",
      },
      customMetadata: { kind: "avatar", userId: authRes.user.id, width: String(image.width), height: String(image.height) },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "avatar_put_failed", key, error: error instanceof Error ? error.message : String(error) }));
    await cleanupPublicObject(bucket, key, "avatar_put_cleanup_failed");
    return c.json({ error: "Upload avatar gagal" }, 503);
  }
  if (!uploaded) {
    await cleanupPublicObject(bucket, key, "avatar_empty_put_cleanup_failed");
    return c.json({ error: "Upload avatar gagal" }, 503);
  }

  const outcome = await casUpdatePublicAssetUrl(readDb(), {
    table: "users",
    idColumn: "id",
    id: authRes.user.id,
    urlColumn: "avatar_url",
    previousUrl,
    newUrl: avatarUrl,
  });
  if (outcome === "ambiguous") {
    return c.json({ error: "Status penyimpanan avatar belum dapat dipastikan — coba muat ulang profil" }, 503);
  }
  if (outcome === "not_committed") {
    await cleanupPublicObject(bucket, key, "avatar_cas_cleanup_failed");
    return c.json({ error: "Avatar berubah oleh permintaan lain — coba lagi" }, 409);
  }

  const oldKey = managedKeyFromPublicUrl(c.req.url, c.env, previousUrl, { kind: "avatar", ownerId: authRes.user.id });
  if (oldKey && oldKey !== key) await cleanupPublicObject(bucket, oldKey, "avatar_old_object_cleanup_failed");
  return c.json({ avatarUrl });
});

app.delete("/avatar", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const bucket = c.env.ASSETS;
  if (!bucket) return c.json({ error: "Public asset storage belum terkonfigurasi" }, 503);
  const previousUrl = authRes.user.avatarUrl ?? null;
  if (!previousUrl) return c.json({ avatarUrl: null });

  const outcome = await casUpdatePublicAssetUrl(readDb(), {
    table: "users",
    idColumn: "id",
    id: authRes.user.id,
    urlColumn: "avatar_url",
    previousUrl,
    newUrl: null,
  });
  if (outcome === "ambiguous") {
    return c.json({ error: "Status penghapusan avatar belum dapat dipastikan — coba muat ulang profil" }, 503);
  }
  if (outcome === "not_committed") return c.json({ error: "Avatar berubah oleh permintaan lain — coba lagi" }, 409);

  const oldKey = managedKeyFromPublicUrl(c.req.url, c.env, previousUrl, { kind: "avatar", ownerId: authRes.user.id });
  if (oldKey) await cleanupPublicObject(bucket, oldKey, "avatar_delete_object_cleanup_failed");
  return c.json({ avatarUrl: null });
});

app.get("/cards", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const dropById = new Map((await listDrops()).map((d) => [d.id, d]));
  const myCards = (await listCards({ ownerId: user.id })).map((ca) => {
    const drop = dropById.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null };
  });
  return c.json({ cards: myCards });
});

// PATCH /privacy — toggle isAnonymous (02-pages PG-USR-10 / PG-PROF-01)
app.patch("/privacy", zValidator("json", z.object({ isAnonymous: z.boolean() }).strict()), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const { isAnonymous } = c.req.valid("json");
  // direct users update (non-money column)
  const db = readDb();
  const { error } = await db.from("users").update({ is_anonymous: isAnonymous }).eq("id", user.id);
  if (error) throw new Error(error.message);
  return c.json({ ok: true, isAnonymous });
});

// PATCH /consent — data consent toggles (docs 09 3.4: consent_analytics_detail + consent_data_market)
app.patch(
  "/consent",
  zValidator("json", z.object({ consentAnalyticsDetail: z.boolean().optional(), consentDataMarket: z.boolean().optional() }).strict()),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const body = c.req.valid("json");
    const patch: Record<string, unknown> = {};
    let consentAnalyticsDetail = user.consentAnalyticsDetail ?? false;
    let consentDataMarket = user.consentDataMarket ?? false;
    if (body.consentAnalyticsDetail !== undefined) {
      patch.consent_analytics_detail = body.consentAnalyticsDetail;
      consentAnalyticsDetail = body.consentAnalyticsDetail;
    }
    if (body.consentDataMarket !== undefined) {
      patch.consent_data_market = body.consentDataMarket;
      consentDataMarket = body.consentDataMarket;
    }
    // direct users update (non-money columns)
    if (Object.keys(patch).length > 0) {
      const db = readDb();
      const { error } = await db.from("users").update(patch).eq("id", user.id);
      if (error) throw new Error(error.message);
    }
    return c.json({ ok: true, consentAnalyticsDetail, consentDataMarket });
  },
);

// PATCH / — update displayName / username
app.patch(
  "/",
  zValidator(
    "json",
    z
      .object({
        // L1 (audit 2026-08-24): forbid characters that would let a stored
        // displayName escape HTML/JSON-LD downstream. Worker-seo.ts already
        // escapes attribute values + </script>, but defense-in-depth at the
        // input stops the bad data from ever entering the DB. Spaces are
        // allowed so names like "Budi Santoso" remain valid.
        displayName: z
          .string()
          .trim()
          .min(2)
          .max(40)
          .regex(/^[^<>&]+$/, "displayName tidak boleh mengandung < > &")
          .refine((s) => Array.from(s).every((c) => c.charCodeAt(0) >= 0x20), "displayName tidak boleh mengandung karakter kontrol")
          .optional(),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{3,20}$/)
          .optional(),
      })
      .strict(),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const body = c.req.valid("json");
    const patch: Record<string, unknown> = {};
    let displayName = user.displayName;
    let username = user.username ?? null;
    let usernameIsAuto = user.usernameIsAuto ?? false;
    if (body.displayName !== undefined) {
      patch.display_name = body.displayName;
      displayName = body.displayName;
    }
    if (body.username !== undefined) {
      if (await isUsernameTaken(body.username, user.id)) return c.json({ error: "Username sudah dipakai — pilih yang lain" }, 409);
      patch.username = body.username;
      patch.username_is_auto = false;
      username = body.username;
      usernameIsAuto = false;
    }
    // direct users update (non-money columns)
    if (Object.keys(patch).length > 0) {
      const db = readDb();
      const { error } = await db.from("users").update(patch).eq("id", user.id);
      if (error) {
        // Race TOCTOU isUsernameTaken -> unique index idx_users_username menolak di sini.
        if (/duplicate key|unique constraint/i.test(error.message)) {
          return c.json({ error: "Username sudah dipakai — pilih yang lain" }, 409);
        }
        throw new Error(error.message);
      }
    }
    return c.json({ user: { id: user.id, displayName, username, usernameIsAuto } });
  },
);

/** Username uniqueness; true when another user already claims it. */
async function isUsernameTaken(username: string, selfId: string): Promise<boolean> {
  const existing = await getUserByUsername(username);
  return existing != null && existing.id !== selfId;
}

export default app;
