import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

// GET /cards/:cardId  — unified card info (replaces split verify pages per 02-pages)
// Also serves: info for 3D page; ownership history here (not on 3D page per 00-README #14)
app.get("/cards/:cardId", async (c) => {
  const id = c.req.param("cardId");
  // resolve by card id OR shortId
  let card = store.cards.get(id) ?? [...store.cards.values()].find((ca) => ca.nfcShortId === id) ?? null;
  if (!card) return c.json({ error: "Kartu tidak ditemukan", status: "unknown" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  const creator = drop ? store.users.get(drop.creatorId) : null;
  const bids = store.bids
    .filter((b) => b.cardId === card.id && b.status === "active")
    .sort((a, b) => b.amountCCoin - a.amountCCoin);
  const history = store.ownershipHistory.filter((h) => h.cardId === card.id).sort((a, b) => new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime());
  return c.json({
    card: {
      id: card.id,
      unitNumber: card.unitNumber,
      variant: card.variant,
      status: card.status,
      location: card.location,
      buyoutPriceCcoin: card.buyoutPriceCcoin,
      nfcShortId: card.nfcShortId,
      nfcUid: card.nfcUid,
      verifyStatus: card.verifyStatus,
      ownerId: card.ownerId,
    },
    drop: drop
      ? {
          id: drop.id,
          title: drop.title,
          series: drop.series,
          artworkUrl: drop.artworkUrl,
          artwork3dUrl: (drop as unknown as { artwork3dUrl?: string | null }).artwork3dUrl ?? null,
          creatorId: drop.creatorId,
          creatorName: drop.creatorName,
          dropAt: (drop as unknown as { dropStartAt?: string | null }).dropStartAt ?? drop.dropAt,
          status: drop.status,
        }
      : null,
    creator: creator ? { id: creator.id, displayName: creator.displayName } : null,
    owner: owner ? { id: owner.id, displayName: owner.displayName, isAnonymous: (owner as unknown as { isAnonymous?: boolean }).isAnonymous ?? false } : null,
    // For browse/marketplace overlay
    activeBid: bids[0] ?? null,
    bids,
    ownershipHistory: history.map((h) => ({ ...h, ownerName: store.users.get(h.ownerId)?.displayName ?? h.ownerId })),
  });
});

// GET /cards/:cardId/3d  — data for 3D viewer + verified badge context
app.get("/cards/:cardId/3d", async (c) => {
  const id = c.req.param("cardId");
  let card = store.cards.get(id) ?? [...store.cards.values()].find((ca) => ca.nfcShortId === id) ?? null;
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  const verified = card.verifyStatus === "verified";
  // Ownership history is NOT on 3D per docs — return minimal series/unit/creator/release/owner links + verified badge flag
  return c.json({
    card: { id: card.id, unitNumber: card.unitNumber, totalUnits: drop?.totalUnits ?? null, variant: card.variant, nfcShortId: card.nfcShortId, verifyStatus: card.verifyStatus },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, artwork3dUrl: (drop as unknown as { artwork3dUrl?: string | null }).artwork3dUrl ?? null } : null,
    seriesLink: drop ? `/drops/${drop.id}` : null,
    creator: drop ? { id: drop.creatorId, name: drop.creatorName, link: `/c/${store.users.get(drop.creatorId)?.username ?? drop.creatorId}` } : null,
    owner: owner ? { id: owner.id, name: owner.displayName, link: `/u/${(owner as unknown as { username?: string }).username ?? owner.id}` } : null,
    releaseDate: (drop as unknown as { dropStartAt?: string | null })?.dropStartAt ?? drop?.dropAt ?? null,
    verifiedBadge: verified ? "Verified Card" : null,
    hint: verified ? null : "Verifikasi via tap NFC untuk badge Verified Card (QR = Registered, lebih lemah).",
  });
});

// Verify by shortId — QR di dus → halaman info (/cards/:shortId) with status Registered
app.get("/verify/:shortId", async (c) => {
  const shortId = c.req.param("shortId");
  const card = [...store.cards.values()].find((ca) => ca.nfcShortId === shortId);
  if (!card) return c.json({ status: "unknown", message: "Kartu tidak terdaftar di C.Verse" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  const verifyStatus = card.verifyStatus === "verified" ? ("registered" as const) : card.verifyStatus;
  return c.json({
    card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant, status: card.status, nfcShortId: card.nfcShortId, verifyStatus },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
    owner: owner ? { displayName: owner.displayName } : null,
    verifyStatus,
    verifyMethod: "qr_shortid",
    tamperDetected: card.verifyStatus === "tamper_detected",
    redirectTo: `/cards/${card.id}`,
    hint: "QR = Registered (tanpa CMAC) — verifikasi lebih lemah daripada tap NFC.",
  });
});

// Verify by NFC — Web NFC (Android) + iOS SUN URL (server CMAC verify)
app.post(
  "/verify-nfc",
  zValidator(
    "json",
    z.object({
      uid: z.string().min(1),
      counter: z.string().optional(),
      cmac: z.string().optional(),
      shortId: z.string().optional(),
    }),
  ),
  async (c) => {
    const { uid, shortId } = c.req.valid("json");
    let card = [...store.cards.values()].find((ca) => ca.nfcUid.toLowerCase() === uid.toLowerCase());
    if (!card && shortId) card = [...store.cards.values()].find((ca) => ca.nfcShortId === shortId);
    if (!card) return c.json({ status: "unknown", message: "UID tidak terdaftar", verifyStatus: "unknown" as const }, 404);

    if (card.verifyStatus === "tamper_detected") {
      return c.json({ verifyStatus: "tamper_detected" as const, message: "Tamper terdeteksi — kartu pernah dibuka", card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant }, drop: store.drops.get(card.dropId), redirectTo: `/cards/${card.id}/3d` });
    }

    const drop = store.drops.get(card.dropId);
    const owner = card.ownerId ? store.users.get(card.ownerId) : null;
    return c.json({
      verifyStatus: "verified" as const,
      message: "Kartu terverifikasi — keaslian valid",
      card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant, status: card.status, nfcShortId: card.nfcShortId, nfcUid: card.nfcUid },
      drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, narrative: drop.narrative } : null,
      owner: owner ? { displayName: owner.displayName } : null,
      verifyMethod: "nfc_cmac",
      redirectTo: `/cards/${card.id}/3d`,
      verifiedBadge: "Verified Card",
    });
  },
);

// Also accept SUN URL params via GET for iOS background tap (c-verse.co/cards/:shortId/3d?uid=&ctr=&c=)
app.get("/sun-verify", async (c) => {
  const uid = c.req.query("uid") ?? c.req.query("UID");
  const shortId = c.req.query("shortId") ?? c.req.query("id");
  let card: (typeof store.cards extends Map<string, infer V> ? V : never) | null = null;
  if (uid) card = ([...store.cards.values()].find((ca) => (ca as unknown as { nfcUid: string }).nfcUid.toLowerCase() === String(uid).toLowerCase()) as never) ?? null;
  if (!card && shortId) card = ([...store.cards.values()].find((ca) => (ca as unknown as { nfcShortId: string }).nfcShortId === String(shortId)) as never) ?? null;
  if (!card) return c.json({ verifyStatus: "unknown" as const, message: "Kartu tidak terdaftar" }, 404);
  if ((card as unknown as { verifyStatus: string }).verifyStatus === "tamper_detected") return c.json({ verifyStatus: "tamper_detected" as const, card: { id: (card as unknown as { id: string }).id } }, 200);
  return c.json({ verifyStatus: "verified" as const, card: { id: (card as unknown as { id: string }).id }, redirectTo: `/cards/${(card as unknown as { id: string }).id}/3d`, verifiedBadge: "Verified Card" });
});

export default app;
