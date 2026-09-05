import { Hono } from "hono";
import { requireUser } from "../../lib/auth.js";
import { sanitizeDbError } from "../../lib/errors.js";
import { getCreatorByHandle, getCreatorByUserId, listCreators, listCreatorUsers } from "../../lib/reads/creators.js";
import { listDrops } from "../../lib/reads/drops.js";
import { getUserByUsernameOrId } from "../../lib/reads/profiles.js";
import { getUserById } from "../../lib/reads/users.js";
import type { CreatorRec } from "../../lib/store.js";

const app = new Hono();

// GET / — list public creators (derived from users.role=creator + creators table for handle/followers)
app.get("/", async (c) => {
  const [creatorUsers, recs, drops] = await Promise.all([listCreatorUsers(), listCreators(), listDrops()]);
  const recByUserId = new Map<string, CreatorRec>(recs.filter((cr) => cr.userId != null).map((cr) => [cr.userId as string, cr]));
  const creators = creatorUsers.map((u) => {
    const rec = recByUserId.get(u.id) ?? null;
    const myDrops = drops.filter((d) => d.creatorId === u.id);
    const totalSold = myDrops.reduce((n, d) => n + d.soldCount, 0);
    const totalUnits = myDrops.reduce((n, d) => n + d.totalUnits, 0);
    return {
      id: u.id,
      displayName: u.displayName,
      username: u.username ?? null,
      handle: rec?.handle ?? null,
      totalFollowersCombined: rec?.totalFollowersCombined ?? null,
      xp: u.totalXp ?? 0,
      stats: { drops: myDrops.length, totalSold, totalUnits },
    };
  });
  return c.json({ creators });
});

// GET /:id — creator by userId or handle or creator rec id; includes published/live drops only for public
app.get("/:id", async (c) => {
  const raw = c.req.param("id");
  // resolve handle first, then user id / username
  const recByHandle = await getCreatorByHandle(raw);
  let user = recByHandle?.userId ? await getUserById(recByHandle.userId) : null;
  if (!user && !recByHandle) user = await getUserByUsernameOrId(raw);
  if (!user || (user.role as string) !== "creator") return c.json({ error: "Creator tidak ditemukan" }, 404);
  if (user.flagReason) return c.json({ error: "Creator tidak ditemukan" }, 404); // suspended: sembunyikan storefront
  const rec = recByHandle ?? (await getCreatorByUserId(user.id));
  const drops = (await listDrops())
    .filter((d) => d.creatorId === user?.id && ["published", "live", "sold_out", "scheduled", "closed"].includes(d.status))
    .sort((a, b) => new Date(b.dropStartAt ?? b.createdAt).getTime() - new Date(a.dropStartAt ?? a.createdAt).getTime());
  return c.json({
    creator: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      handle: rec?.handle ?? null,
      totalFollowersCombined: rec?.totalFollowersCombined ?? null,
      xp: user.totalXp ?? 0,
    },
    drops,
  });
});

// GET /handle/:handle — explicit handle route (for /c/:username frontend)
// HANYA field publik — bank_account/notes TIDAK ikut respons (PII leak fix 2026-08-16).
app.get("/handle/:handle", async (c) => {
  const rec = await getCreatorByHandle(c.req.param("handle"));
  if (!rec) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const user = rec.userId ? await getUserById(rec.userId) : null;
  if (!user) return c.json({ error: "Creator tidak ditemukan" }, 404);
  if (user.flagReason) return c.json({ error: "Creator tidak ditemukan" }, 404);
  const drops = (await listDrops()).filter((d) => d.creatorId === user.id);
  return c.json({
    creator: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      handle: rec.handle,
      bio: null,
      links: [],
      totalFollowersCombined: rec.totalFollowersCombined ?? null,
      xp: user.totalXp ?? 0,
    },
    drops,
  });
});

// POST /apply sengaja DITIADAKAN per docs/03_flows.md Flow 11: akun kreator
// admin-provisioned + passwordless, TIDAK ada registrasi publik. Onboarding via
// POST /api/admin/users/provision dari admin app (active admin role gate).

// P0-4 (audit 2026-08-24): daftar payout user saat ini + daftar drop kreator.
// Endpoint untuk /creator/payouts (PG-CRT-04) dan /creator/drops/:id (PG-CRT-03).
app.get("/me/payouts", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const { readDb } = await import("../../lib/reads.js");
  // readDb imported dynamically to keep cycle-safe re-imports at startup.
  const db = readDb();
  const { data, error } = await db
    .from("payouts")
    .select("id,batch_id,user_id,type,ccoin_amount,idr_amount,withholding_tax,status,requested_at")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  return c.json({ payouts: data ?? [] });
});

app.get("/me/drops", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const allDrops = await listDrops();
  const myDrops = allDrops.filter((d) => d.creatorId === user.id);
  return c.json({ drops: myDrops });
});

// P0-4 (audit 2026-08-24) batch B: PG-CRT-03 — per-drop analytics.
// Verifikasi ownership (drop.creatorId = user.id) sebelum expose data.
// Revenue = sold_count × priceCcoin × C_COIN_RATE_IDR (revenue share 30% adalah
// milik kreator dari primary 70/30). Status escrow mengikuti status order/payout
// (release setelah DELIVERED + H+7 untuk shipping; instant saat vault).
app.get("/me/drops/:dropId", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const { C_COIN_RATE_IDR, REVENUE_SHARE_PLATFORM_PRODUCED } = await import("@c-verse/shared");
  const { getDropById, listCardsByDrop } = await import("../../lib/reads/drops.js");
  const { countCardsWithOwnershipHistory } = await import("./reads.js");
  const drop = await getDropById(c.req.param("dropId"));
  if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);
  if (drop.creatorId !== user.id) return c.json({ error: "Bukan drop kamu" }, 403);
  const cards = await listCardsByDrop(drop.id);
  // Audit batch 2 F2: "sold" = kartu yang pernah pindah tangan (≥1 baris
  // ownership_history — ditulis checkout/draw untuk primary, buyout/accept-bid/
  // release-seed untuk secondary). Status listed_buyout/bid_pending/tampered/
  // defect/lost BUKAN penanda jual — filter status lama menggelembungkan angka.
  const sold = await countCardsWithOwnershipHistory(cards.map((ca) => ca.id));
  const inventory = cards.filter((ca) => ca.status === "inventory");
  const withBid = cards.filter((ca) => ca.buyoutPriceCcoin != null);
  const soldRevenueCcoin = sold * (drop.priceCcoin ?? 0);
  // 70/30 (platform 70 / creator 30) per docs/01_scope.md founder decision —
  // share kreator dari REVENUE_SHARE_PLATFORM_PRODUCED (@c-verse/shared, bukan
  // hardcode). Secondary royalties dilacak terpisah (lihat /api/creators/me/payouts
  // filtered type='royalty').
  const creatorSharePrimaryCcoin = Math.floor(soldRevenueCcoin * REVENUE_SHARE_PLATFORM_PRODUCED.creator);
  const creatorSharePrimaryIdr = creatorSharePrimaryCcoin * C_COIN_RATE_IDR;
  return c.json({
    drop,
    cards: {
      total: cards.length,
      sold,
      inventory: inventory.length,
      withBuyout: withBid.length,
    },
    revenue: {
      soldCcoin: soldRevenueCcoin,
      soldIdr: soldRevenueCcoin * C_COIN_RATE_IDR,
      // 30% creator share untuk primary 70/30
      creatorSharePrimaryCcoin,
      creatorSharePrimaryIdr,
    },
  });
});

export default app;
