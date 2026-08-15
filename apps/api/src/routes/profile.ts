import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { ensureSeed, ensureWallet, store } from "../lib/store.js";

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
  const myCards = [...store.cards.values()].filter((ca) => ca.ownerId === user.id);
  const myOrders = [...store.orders.values()]
    .filter((o) => o.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const myShipments = [...store.shipments.values()]
    .filter((s) => s.requesterId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const myBids = store.bids
    .filter((b) => b.bidderId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const enrichedCards = myCards.map((ca) => {
    const drop = store.drops.get(ca.dropId);
    const activeBid = store.bids.find((b) => b.cardId === ca.id && b.status === "active") ?? null;
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null, activeBid };
  });
  const wallet = ensureWallet(user.id);
  const badges = store.userBadges
    .filter((ub) => ub.userId === user.id)
    .map((ub) => {
      const def = store.badges.find((b) => b.id === ub.badgeId);
      return { ...ub, badge: def };
    });
  const kyc = [...store.kyc.values()].find((k) => k.userId === user.id) ?? null;
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
  const myCards = [...store.cards.values()]
    .filter((ca) => ca.ownerId === user.id)
    .map((ca) => {
      const drop = store.drops.get(ca.dropId);
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
  if (typeof body.consentAnalyticsDetail === "boolean")
    (user as unknown as Record<string, unknown>).consentAnalyticsDetail = body.consentAnalyticsDetail;
  if (typeof body.consentDataMarket === "boolean") (user as unknown as Record<string, unknown>).consentDataMarket = body.consentDataMarket;
  return c.json({
    ok: true,
    consentAnalyticsDetail: (user as unknown as { consentAnalyticsDetail?: boolean }).consentAnalyticsDetail ?? false,
    consentDataMarket: (user as unknown as { consentDataMarket?: boolean }).consentDataMarket ?? false,
  });
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
  if (body.displayName != null) {
    const s = String(body.displayName).trim();
    if (s.length >= 2 && s.length <= 40) (user as unknown as Record<string, unknown>).displayName = s;
  }
  if (body.username != null) {
    const s = String(body.username).trim().toLowerCase();
    if (
      /^[a-z0-9_]{3,20}$/.test(s) &&
      ![...store.users.values()].some((u) => (u as unknown as { username?: string }).username === s && u.id !== user.id)
    ) {
      (user as unknown as Record<string, unknown>).username = s;
    }
  }
  return c.json({
    user: { id: user.id, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null },
  });
});

export default app;
