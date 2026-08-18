import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { listBids } from "../lib/reads/bids.js";
import { listCards, listDrops } from "../lib/reads/drops.js";
import { listOrdersByUser, listShipmentsByRequester } from "../lib/reads/orders.js";
import { getKycByUser, getWalletByUser, listUserBadges } from "../lib/reads/profile.js";
import { getUserByUsername } from "../lib/reads/users.js";
import { readDb } from "../lib/reads.js";
import type { Bid } from "../lib/store.js";

const app = new Hono();

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
      drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
      activeBid: activeBidByCard.get(ca.id) ?? null,
    };
  });
  const wallet = await getWalletByUser(user.id);
  const badges = await listUserBadges(user.id);
  const kyc = await getKycByUser(user.id);
  const totalXp = (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0;
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
    listings: [],
    badges,
    kyc,
    stats: {
      totalCards: myCards.length,
      vaultCards: myCards.filter((ca) => ca.location === "platform_vault").length,
      withOwnerCards: myCards.filter((ca) => ca.location === "with_owner").length,
      buyoutListed: myCards.filter((ca) => ca.buyoutPriceCcoin != null).length,
      totalOrders: myOrders.length,
    },
  });
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
        displayName: z.string().trim().min(2).max(40).optional(),
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
