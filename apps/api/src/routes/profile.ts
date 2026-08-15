import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { isDbEnabled } from "../lib/db.js";
import { listBids } from "../lib/reads/bids.js";
import { listCards, listDrops } from "../lib/reads/drops.js";
import { listOrdersByUser, listShipmentsByRequester } from "../lib/reads/orders.js";
import { getKycByUser, getWalletByUser, listUserBadges } from "../lib/reads/profile.js";
import { getUserByUsername } from "../lib/reads/users.js";
import { readDb } from "../lib/reads.js";
import type { Bid } from "../lib/store.js";
import { ensureSeed, store } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

// GET / — my profile, cards, orders, shipments, badges, kyc, level
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const myCards = await listCards({ ownerId: user.id });
  const myOrders = await listOrdersByUser(user.id);
  const myShipments = await listShipmentsByRequester(user.id);
  const myBids = (await listBids({ bidderId: user.id })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const dropById = new Map((await listDrops()).map((d) => [d.id, d]));
  const activeBidByCard = new Map<string, Bid>();
  for (const b of await listBids({ status: "active" })) {
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
app.patch("/privacy", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  let body: { isAnonymous?: boolean } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    // no body
  }
  const isAnonymous = Boolean(body.isAnonymous);
  // DB path: direct users update (non-money column)
  if (isDbEnabled()) {
    const db = readDb();
    if (db) {
      const { error } = await db.from("users").update({ is_anonymous: isAnonymous }).eq("id", user.id);
      if (error) throw new Error(error.message);
      return c.json({ ok: true, isAnonymous });
    }
  }
  (user as unknown as Record<string, unknown>).isAnonymous = isAnonymous;
  return c.json({ ok: true, isAnonymous });
});

// PATCH /consent — data consent toggles (docs 09 3.4: consent_analytics_detail + consent_data_market)
app.patch("/consent", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  let body: { consentAnalyticsDetail?: boolean; consentDataMarket?: boolean } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {}
  const patch: Record<string, unknown> = {};
  let consentAnalyticsDetail = user.consentAnalyticsDetail ?? false;
  let consentDataMarket = user.consentDataMarket ?? false;
  if (typeof body.consentAnalyticsDetail === "boolean") {
    patch.consent_analytics_detail = body.consentAnalyticsDetail;
    consentAnalyticsDetail = body.consentAnalyticsDetail;
  }
  if (typeof body.consentDataMarket === "boolean") {
    patch.consent_data_market = body.consentDataMarket;
    consentDataMarket = body.consentDataMarket;
  }
  // DB path: direct users update (non-money columns)
  if (isDbEnabled()) {
    const db = readDb();
    if (db) {
      if (Object.keys(patch).length > 0) {
        const { error } = await db.from("users").update(patch).eq("id", user.id);
        if (error) throw new Error(error.message);
      }
      return c.json({ ok: true, consentAnalyticsDetail, consentDataMarket });
    }
  }
  if (typeof body.consentAnalyticsDetail === "boolean")
    (user as unknown as Record<string, unknown>).consentAnalyticsDetail = body.consentAnalyticsDetail;
  if (typeof body.consentDataMarket === "boolean") (user as unknown as Record<string, unknown>).consentDataMarket = body.consentDataMarket;
  return c.json({ ok: true, consentAnalyticsDetail, consentDataMarket });
});

// PATCH / — update displayName / avatar / username
app.patch("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  let body: { displayName?: string; avatarUrl?: string; username?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {}
  const patch: Record<string, unknown> = {};
  let displayName = user.displayName;
  let username = user.username ?? null;
  if (body.displayName != null) {
    const s = String(body.displayName).trim();
    if (s.length >= 2 && s.length <= 40) {
      patch.display_name = s;
      displayName = s;
    }
  }
  if (body.username != null) {
    const s = String(body.username).trim().toLowerCase();
    if (/^[a-z0-9_]{3,20}$/.test(s) && !(await isUsernameTaken(s, user.id))) {
      patch.username = s;
      username = s;
    }
  }
  // DB path: direct users update (non-money columns)
  if (isDbEnabled()) {
    const db = readDb();
    if (db) {
      if (Object.keys(patch).length > 0) {
        const { error } = await db.from("users").update(patch).eq("id", user.id);
        if (error) throw new Error(error.message);
      }
      return c.json({ user: { id: user.id, displayName, username } });
    }
  }
  if (patch.display_name != null) (user as unknown as Record<string, unknown>).displayName = displayName;
  if (patch.username != null) (user as unknown as Record<string, unknown>).username = username;
  return c.json({ user: { id: user.id, displayName, username } });
});

/** Username uniqueness across both sources; true when another user already claims it. */
async function isUsernameTaken(username: string, selfId: string): Promise<boolean> {
  const db = readDb();
  if (db) {
    const existing = await getUserByUsername(username);
    return existing != null && existing.id !== selfId;
  }
  return [...store.users.values()].some((u) => ((u as unknown as { username?: string }).username ?? "") === username && u.id !== selfId);
}

export default app;
