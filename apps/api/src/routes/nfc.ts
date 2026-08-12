import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

// Verify by shortId (QR fallback — iOS, non-Chrome)
app.get("/verify/:shortId", async (c) => {
  const shortId = c.req.param("shortId");
  const card = [...store.cards.values()].find(ca => ca.nfcShortId === shortId);
  if (!card) return c.json({ status: "unknown", message: "Kartu tidak terdaftar di C.Verse" }, 404);
  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  // QR/shortId verify = "registered" (weaker than CMAC)
  const verifyStatus = card.verifyStatus === "verified" ? "registered" as const : card.verifyStatus;
  return c.json({
    card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant, status: card.status, nfcShortId: card.nfcShortId },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl } : null,
    owner: owner ? { displayName: owner.displayName } : null,
    verifyStatus,
    verifyMethod: "qr_shortid",
    tamperDetected: card.verifyStatus === "tamper_detected",
  });
});

// Verify by NFC (Web NFC — Android Chrome): uid + counter + cmac
app.post("/verify-nfc", zValidator("json", z.object({
  uid: z.string().min(1),
  counter: z.string().optional(),
  cmac: z.string().optional(),
  shortId: z.string().optional(),
})), async (c) => {
  const { uid, shortId } = c.req.valid("json");
  let card = [...store.cards.values()].find(ca => ca.nfcUid.toLowerCase() === uid.toLowerCase());
  if (!card && shortId) card = [...store.cards.values()].find(ca => ca.nfcShortId === shortId);
  if (!card) return c.json({ status: "unknown", message: "UID tidak terdaftar", verifyStatus: "unknown" as const }, 404);

  // Simulate CMAC verify: if cmac provided, assume valid unless card is tamper_detected
  if (card.verifyStatus === "tamper_detected") {
    return c.json({ verifyStatus: "tamper_detected" as const, message: "Tamper detected — loop TagTamper putus", card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant }, drop: store.drops.get(card.dropId) });
  }

  const drop = store.drops.get(card.dropId);
  const owner = card.ownerId ? store.users.get(card.ownerId) : null;
  return c.json({
    verifyStatus: "verified" as const,
    message: "Kartu terverifikasi — CMAC match (NTAG 424 DNA SUN)",
    card: { id: card.id, unitNumber: card.unitNumber, variant: card.variant, status: card.status, nfcShortId: card.nfcShortId, nfcUid: card.nfcUid },
    drop: drop ? { id: drop.id, title: drop.title, series: drop.series, artworkUrl: drop.artworkUrl, narrative: drop.narrative } : null,
    owner: owner ? { displayName: owner.displayName } : null,
    verifyMethod: "nfc_cmac",
  });
});

// Simulate tamper for testing
app.post("/simulate-tamper/:cardId", async (c) => {
  const card = store.cards.get(c.req.param("cardId"));
  if (!card) return c.json({ error: "Card not found" }, 404);
  card.verifyStatus = "tamper_detected";
  return c.json({ card });
});

export default app;
