import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { deriveAppKey, verifySun } from "../../lib/cmac.js";
import { listBids } from "../../lib/reads/bids.js";
import { getCardByIdOrNfc, getDropById } from "../../lib/reads/drops.js";
import { logAuditDb } from "../../lib/reads/kyc.js";
import { getUserById, listUsersByIds } from "../../lib/reads/users.js";
import type { Card } from "../../lib/store.js";
import { getSupabase } from "../../lib/supabase.js";
import { getCardByNfcShortId, getCardByNfcUid, listOwnershipByCard } from "./reads.js";

// NFC verification (docs/12): SUN/CMAC real verification — never "verified" without crypto match.

const app = new Hono();

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

/**
 * Persist verification state to Postgres — semua ATOMIC (docs/12 §4):
 * - verified: UPDATE ... WHERE last_ctr < ctr (anti-replay di level DB, bukan read-modify-write JS)
 * - tamper: permanen; counter tetap dimajukan (tap valid terjadi)
 * - registered (QR-grade): hanya upgrade unknown/registered — TIDAK PERNAH menurunkan
 *   verified/tamper_detected.
 */
async function persistVerified(cardId: string, ctr: number): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cards")
    .update({ verify_status: "verified", last_ctr: ctr })
    .eq("id", cardId)
    .lt("last_ctr", ctr)
    .not("verify_status", "eq", "tamper_detected")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

async function persistTampered(cardId: string, ctr: number | null): Promise<void> {
  const supabase = getSupabase();
  if (ctr == null) {
    // Caller determined the counter cannot advance (stale SUN replay); set the flag
    // alone. CMAC validation upstream already authenticates the SUN message.
    const { error } = await supabase.from("cards").update({ verify_status: "tamper_detected" }).eq("id", cardId);
    if (error) throw new Error(error.message);
    return;
  }
  // M3 (audit 2026-08-24): combine counter advance + flag flip into a single UPDATE
  // guarded by `last_ctr < ctr`. The previous two-statement flow set the flag
  // unconditionally, so a stale SUN replay that somehow passed CMAC validation could
  // flip tamper even when the counter didn't actually advance (defense-in-depth).
  const { data, error } = await supabase
    .from("cards")
    .update({ verify_status: "tamper_detected", last_ctr: ctr })
    .eq("id", cardId)
    .lt("last_ctr", ctr)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // Counter race: another concurrent tap already advanced past ctr. The flag is
    // already set on whichever tap saw the tamper bit first; defensively ensure it
    // here too so we never miss a tamp detection.
    const { error: e2 } = await supabase.from("cards").update({ verify_status: "tamper_detected" }).eq("id", cardId);
    if (e2) throw new Error(e2.message);
  }
}

async function persistRegistered(cardId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("cards")
    .update({ verify_status: "registered" })
    .eq("id", cardId)
    .in("verify_status", ["unknown", "registered"]);
  if (error) throw new Error(error.message);
}

/** Display status untuk path QR: pertahankan status lebih kuat yang sudah ada. */
function qrDisplayStatus(current: string): "verified" | "tamper_detected" | "registered" {
  if (current === "tamper_detected") return "tamper_detected";
  if (current === "verified") return "verified";
  return "registered";
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
    await logAuditDb("system", "view_sensitive", "cards", card.id, { fraud: "nfc_cmac_invalid", reason: result.reason }, null, null);
    return { verifyStatus: "unknown", message: "Verifikasi kripto gagal", reason: result.reason };
  }

  const ctrNum = Number.parseInt(input.ctrHex, 16);
  if (!Number.isFinite(ctrNum)) {
    return { verifyStatus: "unknown", message: "Counter tidak valid", reason: "bad_ctr" };
  }

  // Tamper bit hanya dipercaya setelah CMAC valid — bit ini bagian dari pesan SUN
  // yang ter-autentikasi (docs/12 §2.2 p4). Permanen + wajib meninggalkan audit trail.
  if (input.tamperFlag) {
    await persistTampered(card.id, ctrNum > card.lastCtr ? ctrNum : null);
    await logAuditDb(
      "system",
      "view_sensitive",
      "cards",
      card.id,
      { fraud: "nfc_tamper_flagged", ctr: ctrNum, lastCtr: card.lastCtr },
      null,
      null,
    );
    return { verifyStatus: "tamper_detected", message: "TagTamper aktif — kartu terindikasi dibuka" };
  }

  // Anti-replay: counter must strictly advance — enforced atomically di DB
  // (UPDATE ... WHERE last_ctr < ctr), bukan read-check-write JS.
  if (ctrNum <= card.lastCtr) {
    await logAuditDb(
      "system",
      "view_sensitive",
      "cards",
      card.id,
      { fraud: "nfc_counter_replay", ctr: ctrNum, lastCtr: card.lastCtr },
      null,
      null,
    );
    return { verifyStatus: "unknown", message: "Counter tidak bertambah (replay ditolak)", reason: "counter_replay" };
  }

  const persisted = await persistVerified(card.id, ctrNum);
  if (!persisted) {
    // Race: tap lain sudah memajukan counter lebih tinggi → replay.
    await logAuditDb(
      "system",
      "view_sensitive",
      "cards",
      card.id,
      { fraud: "nfc_counter_replay", ctr: ctrNum, lastCtr: card.lastCtr },
      null,
      null,
    );
    return { verifyStatus: "unknown", message: "Counter tidak bertambah (replay ditolak)", reason: "counter_replay" };
  }
  return { verifyStatus: "verified", message: "Kartu terverifikasi — keaslian valid" };
}

// GET /cards/:cardId — unified card info (ownership history here, not on 3D per docs/02)
app.get("/cards/:cardId", async (c) => {
  const card = await getCardByIdOrNfc(c.req.param("cardId"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan", status: "unknown" }, 404);
  const [drop, owner, bidList, history] = await Promise.all([
    getDropById(card.dropId),
    card.ownerId ? getUserById(card.ownerId) : Promise.resolve(null),
    listBids({ cardId: card.id, status: "active" }),
    listOwnershipByCard(card.id),
  ]);
  const bids = bidList.sort((a, b) => b.amountCCoin - a.amountCCoin);
  const [creator, users] = await Promise.all([
    drop ? getUserById(drop.creatorId) : Promise.resolve(null),
    listUsersByIds([...new Set(history.map((h) => h.ownerId))]),
  ]);
  // Privacy: owner yang sekarang is_anonymous atau suspended HARUS disamarkan jadi "Anonim" — biar
  // orang tidak bisa melacak displayName historis user yang sudah memilih jadi anon.
  const ownerNames = new Map(users.map((u) => [u.id, u.isAnonymous || u.flagReason ? "Anonim" : u.displayName] as const));
  return c.json({
    card: {
      id: card.id,
      unitNumber: card.unitNumber,
      variant: card.variant,
      status: card.status,
      location: card.location,
      buyoutPriceCcoin: card.buyoutPriceCcoin,
      nfcShortId: card.nfcShortId,
      // nfcUid sengaja TIDAK diekspos — itu input diversifikasi kunci CMAC (docs/12); publik cukup nfcShortId.
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
          isSeed: drop.isSeed,
        }
      : null,
    creator: creator ? { id: creator.id, displayName: creator.displayName, username: creator.username ?? null } : null,
    owner: owner
      ? { id: owner.id, displayName: owner.displayName, username: owner.username ?? null, isAnonymous: owner.isAnonymous ?? false }
      : null,
    activeBid: bids[0] ?? null,
    bids,
    ownershipHistory: history.map((h) => ({ ...h, ownerName: ownerNames.get(h.ownerId) ?? "—" })),
  });
});

// GET /cards/:cardId/3d — 3D viewer data. SUN URL params (?uid=&ctr=&c=) trigger CMAC verification.
app.get("/cards/:cardId/3d", async (c) => {
  const card = await getCardByIdOrNfc(c.req.param("cardId"));
  if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  const [drop, owner] = await Promise.all([getDropById(card.dropId), card.ownerId ? getUserById(card.ownerId) : Promise.resolve(null)]);

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
      ? {
          id: drop.id,
          title: drop.title,
          series: drop.series,
          artworkUrl: drop.artworkUrl,
          artwork3dUrl: drop.artwork3dUrl ?? null,
          isSeed: drop.isSeed,
        }
      : null,
    seriesLink: drop ? `/drops/${drop.id}` : null,
    creator: drop
      ? { id: drop.creatorId, name: drop.creatorName, link: `/c/${(await getUserById(drop.creatorId))?.username ?? drop.creatorId}` }
      : null,
    owner: owner ? { id: owner.id, name: owner.displayName, link: `/u/${owner.username ?? owner.id}` } : null,
    releaseDate: drop?.dropStartAt ?? drop?.dropAt ?? null,
    verifiedBadge: verified ? "Verified Card" : verifyStatus === "tamper_detected" ? "Tamper Detected" : null,
    hint: verified ? null : "Verifikasi via tap NFC untuk badge Verified Card (QR = Registered, lebih lemah).",
  });
});

// GET /verify/:shortId — QR di dus → maksimal "registered" (tanpa CMAC per docs/03 Flow 4).
// TIDAK PERNAH menurunkan status verified/tamper_detected yang sudah diraih.
app.get("/verify/:shortId", async (c) => {
  const card = await getCardByNfcShortId(c.req.param("shortId"));
  if (!card) return c.json({ status: "unknown", message: "Kartu tidak terdaftar di C.Verse" }, 404);
  const drop = await getDropById(card.dropId);
  const owner = card.ownerId ? await getUserById(card.ownerId) : null;
  await persistRegistered(card.id);
  const display = qrDisplayStatus(card.verifyStatus);
  return c.json({
    card: {
      id: card.id,
      unitNumber: card.unitNumber,
      variant: card.variant,
      status: card.status,
      nfcShortId: card.nfcShortId,
      verifyStatus: display,
    },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
    owner: owner ? { displayName: owner.displayName } : null,
    verifyStatus: display,
    verifyMethod: "qr_shortid",
    tamperDetected: display === "tamper_detected",
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
    let card = await getCardByNfcUid(uid);
    if (!card && shortId) card = await getCardByNfcShortId(shortId);
    if (!card) return c.json({ status: "unknown", message: "UID tidak terdaftar", verifyStatus: "unknown" as const }, 404);

    if (!counter || !cmac) {
      // No crypto fields -> QR-grade only (tidak menurunkan verified/tamper)
      await persistRegistered(card.id);
      const display = qrDisplayStatus(card.verifyStatus);
      return c.json({
        verifyStatus: display,
        message: display === "tamper_detected" ? "Tamper terdeteksi" : "Registered (tanpa CMAC)",
        card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant },
        redirectTo: `/cards/${card.id}/3d`,
      });
    }

    const outcome = await verifyTap(card, { uidHex: uid, ctrHex: counter, cmacHex: cmac });
    const [drop, owner] = await Promise.all([getDropById(card.dropId), card.ownerId ? getUserById(card.ownerId) : Promise.resolve(null)]);
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
  if (uidParam) card = await getCardByNfcUid(String(uidParam));
  if (!card && shortId) card = await getCardByNfcShortId(String(shortId));
  if (!card) return c.json({ verifyStatus: "unknown" as const, message: "Kartu tidak terdaftar" }, 404);
  // Konsistensi param: bila kedua identifier dikirim, keduanya harus merujuk kartu yang sama.
  if (uidParam && shortId && card.nfcShortId !== String(shortId)) {
    return c.json({ verifyStatus: "unknown" as const, message: "Identifier kartu tidak konsisten" }, 404);
  }

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
  await persistRegistered(card.id);
  return c.json({ verifyStatus: qrDisplayStatus(card.verifyStatus), card: { id: card.id }, redirectTo: `/cards/${card.id}/3d` });
});

export default app;
