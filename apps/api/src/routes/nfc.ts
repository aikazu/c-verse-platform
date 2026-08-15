import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { deriveAppKey, verifySun } from "../lib/cmac.js";
import { type Card, ensureSeed, logAudit, store } from "../lib/store.js";
import { getSupabase } from "../lib/supabase.js";

// NFC verification (docs/12): SUN/CMAC real verification — never "verified" without crypto match.

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

function masterKeyBytes(): Uint8Array | null {
  const hex = getEnv("NFC_MASTER_KEY");
  if (!hex || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));
}

function findCard(idOrShortId: string): Card | null {
  return store.cards.get(idOrShortId) ?? [...store.cards.values()].find((ca) => ca.nfcShortId === idOrShortId) ?? null;
}

/** Persist verification state to Postgres when wired; store fallback keeps dev demo working. */
async function persistVerification(card: Card): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("cards").update({ verify_status: card.verifyStatus, last_ctr: card.lastCtr }).eq("id", card.id);
}

interface TapInput {
  uidHex: string;
  ctrHex: string;
  cmacHex: string;
  tamperFlag?: boolean;
}

interface TapOutcome {
  verifyStatus: "verified" | "tamper_detected" | "unknown";
  message: string;
  reason?: string;
}

/** Core SUN verification: CMAC check -> anti-replay (ctr must advance) -> tamper permanence. */
async function verifyTap(card: Card, input: TapInput): Promise<TapOutcome> {
  if (card.verifyStatus === "tamper_detected") {
    return { verifyStatus: "tamper_detected", message: "Tamper terdeteksi — kartu pernah dibuka" };
  }
  if (input.tamperFlag) {
    card.verifyStatus = "tamper_detected"; // irreversible per docs/12 §2.2 p4
    await persistVerification(card);
    return { verifyStatus: "tamper_detected", message: "TagTamper aktif — kartu terindikasi dibuka" };
  }

  const master = masterKeyBytes();
  if (!master) {
    // No master key configured (dev): never issue "verified" — QR-grade only.
    return { verifyStatus: "unknown", message: "Verifikasi kripto tidak terkonfigurasi", reason: "nfc_master_key_missing" };
  }

  const uidBytes = new Uint8Array((card.nfcUid.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));
  if (uidBytes.length !== 7) {
    return { verifyStatus: "unknown", message: "Format UID tidak valid", reason: "bad_uid" };
  }
  const appKey = await deriveAppKey(master, uidBytes);
  const result = await verifySun({ uidHex: input.uidHex, ctrHex: input.ctrHex, cmacHex: input.cmacHex }, appKey);
  if (!result.valid) {
    logAudit("system", "view_sensitive", "cards", card.id, { fraud: "nfc_cmac_invalid", reason: result.reason }, null, null);
    return { verifyStatus: "unknown", message: "Verifikasi kripto gagal", reason: result.reason };
  }

  // Anti-replay: counter must strictly advance
  const ctrNum = Number.parseInt(input.ctrHex, 16);
  if (!Number.isFinite(ctrNum) || ctrNum <= card.lastCtr) {
    logAudit("system", "view_sensitive", "cards", card.id, { fraud: "nfc_counter_replay", ctr: ctrNum, lastCtr: card.lastCtr }, null, null);
    return { verifyStatus: "unknown", message: "Counter tidak bertambah (replay ditolak)", reason: "counter_replay" };
  }

  card.lastCtr = ctrNum;
  card.verifyStatus = "verified";
  await persistVerification(card);
  return { verifyStatus: "verified", message: "Kartu terverifikasi — keaslian valid" };
}

// GET /cards/:cardId — unified card info (ownership history here, not on 3D per docs/02)
app.get("/cards/:cardId", async (c) => {
  const card = findCard(c.req.param("cardId"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan", status: "unknown" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  const creator = drop ? store.users.get(drop.creatorId) : null;
  const bids = store.bids.filter((b) => b.cardId === card.id && b.status === "active").sort((a, b) => b.amountCCoin - a.amountCCoin);
  const history = store.ownershipHistory
    .filter((h) => h.cardId === card.id)
    .sort((a, b) => new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime());
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
          artwork3dUrl: drop.artwork3dUrl ?? null,
          creatorId: drop.creatorId,
          creatorName: drop.creatorName,
          dropAt: drop.dropStartAt ?? drop.dropAt,
          status: drop.status,
        }
      : null,
    creator: creator ? { id: creator.id, displayName: creator.displayName } : null,
    owner: owner ? { id: owner.id, displayName: owner.displayName, isAnonymous: owner.isAnonymous ?? false } : null,
    activeBid: bids[0] ?? null,
    bids,
    ownershipHistory: history.map((h) => ({ ...h, ownerName: store.users.get(h.ownerId)?.displayName ?? h.ownerId })),
  });
});

// GET /cards/:cardId/3d — 3D viewer data. SUN URL params (?uid=&ctr=&c=) trigger CMAC verification.
app.get("/cards/:cardId/3d", async (c) => {
  const card = findCard(c.req.param("cardId"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;

  let verifyStatus = card.verifyStatus;
  const uidQ = c.req.query("uid");
  const ctrQ = c.req.query("ctr");
  const cmacQ = c.req.query("c") ?? c.req.query("cmac");
  if (uidQ && ctrQ && cmacQ) {
    const outcome = await verifyTap(card, { uidHex: uidQ, ctrHex: ctrQ, cmacHex: cmacQ, tamperFlag: c.req.query("t") === "1" });
    verifyStatus = outcome.verifyStatus;
  } else {
    // Bare visit (QR / link): weaker label — at most "registered", never "verified"
    verifyStatus = card.verifyStatus === "tamper_detected" ? "tamper_detected" : card.ownerId ? "registered" : "unknown";
  }

  const verified = verifyStatus === "verified";
  return c.json({
    card: {
      id: card.id,
      unitNumber: card.unitNumber,
      totalUnits: drop?.totalUnits ?? null,
      variant: card.variant,
      nfcShortId: card.nfcShortId,
      verifyStatus,
    },
    drop: drop
      ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, artwork3dUrl: drop.artwork3dUrl ?? null }
      : null,
    seriesLink: drop ? `/drops/${drop.id}` : null,
    creator: drop
      ? { id: drop.creatorId, name: drop.creatorName, link: `/c/${store.users.get(drop.creatorId)?.username ?? drop.creatorId}` }
      : null,
    owner: owner ? { id: owner.id, name: owner.displayName, link: `/u/${owner.username ?? owner.id}` } : null,
    releaseDate: drop?.dropStartAt ?? drop?.dropAt ?? null,
    verifiedBadge: verified ? "Verified Card" : verifyStatus === "tamper_detected" ? "Tamper Detected" : null,
    hint: verified ? null : "Verifikasi via tap NFC untuk badge Verified Card (QR = Registered, lebih lemah).",
  });
});

// GET /verify/:shortId — QR di dus → maksimal "registered" (tanpa CMAC per docs/03 Flow 4)
app.get("/verify/:shortId", async (c) => {
  const card = [...store.cards.values()].find((ca) => ca.nfcShortId === c.req.param("shortId"));
  if (!card) return c.json({ status: "unknown", message: "Kartu tidak terdaftar di C.Verse" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  if (card.verifyStatus !== "tamper_detected") {
    card.verifyStatus = "registered";
    await persistVerification(card);
  }
  return c.json({
    card: {
      id: card.id,
      unitNumber: card.unitNumber,
      variant: card.variant,
      status: card.status,
      nfcShortId: card.nfcShortId,
      verifyStatus: card.verifyStatus,
    },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
    owner: owner ? { displayName: owner.displayName } : null,
    verifyStatus: card.verifyStatus,
    verifyMethod: "qr_shortid",
    tamperDetected: card.verifyStatus === "tamper_detected",
    redirectTo: `/cards/${card.id}`,
    hint: "QR = Registered (tanpa CMAC) — verifikasi lebih lemah daripada tap NFC.",
  });
});

// POST /verify-nfc — Web NFC programmatic read (Android Chrome)
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
    const { uid, counter, cmac, shortId } = c.req.valid("json");
    let card = [...store.cards.values()].find((ca) => ca.nfcUid.toLowerCase() === uid.toLowerCase());
    if (!card && shortId) card = [...store.cards.values()].find((ca) => ca.nfcShortId === shortId);
    if (!card) return c.json({ status: "unknown", message: "UID tidak terdaftar", verifyStatus: "unknown" as const }, 404);

    if (!counter || !cmac) {
      // No crypto fields -> QR-grade only
      if (card.verifyStatus !== "tamper_detected") card.verifyStatus = "registered";
      await persistVerification(card);
      return c.json({
        verifyStatus: card.verifyStatus,
        message: card.verifyStatus === "tamper_detected" ? "Tamper terdeteksi" : "Registered (tanpa CMAC)",
        card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant },
        redirectTo: `/cards/${card.id}/3d`,
      });
    }

    const outcome = await verifyTap(card, { uidHex: uid, ctrHex: counter, cmacHex: cmac });
    const drop = store.drops.get(card.dropId);
    const owner = card.ownerId ? store.users.get(card.ownerId) : null;
    return c.json({
      verifyStatus: outcome.verifyStatus,
      message: outcome.message,
      reason: outcome.reason ?? null,
      card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant, status: card.status, nfcShortId: card.nfcShortId },
      drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, narrative: drop.narrative } : null,
      owner: owner ? { displayName: owner.displayName } : null,
      verifyMethod: "nfc_cmac",
      redirectTo: `/cards/${card.id}/3d`,
      verifiedBadge: outcome.verifyStatus === "verified" ? "Verified Card" : null,
    });
  },
);

// GET /sun-verify — iOS background tap lands here with ?uid=&ctr=&c=
app.get("/sun-verify", async (c) => {
  const uidParam = c.req.query("uid") ?? c.req.query("UID");
  const shortId = c.req.query("shortId") ?? c.req.query("id");
  let card: Card | null = null;
  if (uidParam) card = [...store.cards.values()].find((ca) => ca.nfcUid.toLowerCase() === String(uidParam).toLowerCase()) ?? null;
  if (!card && shortId) card = [...store.cards.values()].find((ca) => ca.nfcShortId === String(shortId)) ?? null;
  if (!card) return c.json({ verifyStatus: "unknown" as const, message: "Kartu tidak terdaftar" }, 404);

  const ctr = c.req.query("ctr");
  const cmac = c.req.query("c") ?? c.req.query("cmac");
  if (uidParam && ctr && cmac) {
    const outcome = await verifyTap(card, { uidHex: uidParam, ctrHex: ctr, cmacHex: cmac, tamperFlag: c.req.query("t") === "1" });
    return c.json({
      verifyStatus: outcome.verifyStatus,
      reason: outcome.reason ?? null,
      card: { id: card.id },
      redirectTo: `/cards/${card.id}/3d`,
      verifiedBadge: outcome.verifyStatus === "verified" ? "Verified Card" : null,
    });
  }
  if (card.verifyStatus !== "tamper_detected") card.verifyStatus = "registered";
  await persistVerification(card);
  return c.json({ verifyStatus: card.verifyStatus, card: { id: card.id }, redirectTo: `/cards/${card.id}/3d` });
});

export default app;
