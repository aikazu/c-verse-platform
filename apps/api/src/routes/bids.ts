import { acceptBidSchema } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { RpcError, rpcAcceptBid, rpcCancelBid, rpcPlaceBid, userDb } from "../lib/db.js";
import { listBidsByCard } from "../lib/reads/bids.js";

const app = new Hono();

// GET bids for a card
app.get("/:id", async (c) => {
  const bids = await listBidsByCard(c.req.param("id"));
  const sorted = [...bids].sort(
    (a, b) => b.amountCCoin - a.amountCCoin || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return c.json({ bids: sorted });
});

app.get("/card/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const windowDays = Number(c.req.query("days") ?? 90);
  const cutoff = Date.now() - windowDays * 86400000;
  const bids = await listBidsByCard(cardId);
  const filtered = bids
    .filter((b) => b.status === "accepted" || new Date(b.createdAt).getTime() >= cutoff)
    .sort((a, b) => b.amountCCoin - a.amountCCoin || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ bids: filtered });
});

// POST / — place bid directly on card (docs 03 Flow 7: outbid + hold)
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1).optional(),
      amountCCoin: z.number().int().min(1).optional(),
      amountCcoin: z.number().int().min(1).optional(),
      amount_ccoin: z.number().int().min(1).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);

    const raw = c.req.valid("json") as { cardId?: string; amountCCoin?: number; amountCcoin?: number; amount_ccoin?: number };
    const cardId = raw.cardId ?? null;
    if (!cardId) return c.json({ error: "cardId wajib (bid langsung di kartu)" }, 400);
    const amount = raw.amountCcoin ?? raw.amountCCoin ?? raw.amount_ccoin;
    if (amount == null || amount < 1) return c.json({ error: "amount wajib integer ≥ 1" }, 400);

    const db = userDb(authRes.token);
    try {
      const bid = await rpcPlaceBid(db, cardId, amount);
      return c.json({ bid, activeBid: bid }, 201);
    } catch (err) {
      if (err instanceof RpcError) {
        const status = err.code === "INSUFFICIENT" ? 402 : err.code === "AUTH_REQUIRED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  },
);

// POST /:id/cancel — bidder cancel own active/outbid bid (C-Coin release)
app.post("/:id/cancel", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const db = userDb(authRes.token);
  try {
    const bid = await rpcCancelBid(db, c.req.param("id"));
    return c.json({ ok: true, bid });
  } catch (err) {
    if (err instanceof RpcError) return c.json({ error: err.message, code: err.code }, err.code === "FORBIDDEN" ? 403 : 400);
    throw err;
  }
});

// POST /cards/:cardId/accept — accept current active bid on card.
// Founder 2026-08-28: SEMUA pembelian settle ke vault — body kosong (strict),
// destination/address bukan lagi input user. Shipping pasca-vault via
// POST /api/orders/vault-shipout; RPC SQL mengabaikan address untuk settle
// non-seed.
app.post("/cards/:cardId/accept", zValidator("json", acceptBidSchema), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const cardId = c.req.param("cardId");
  const db = userDb(authRes.token);
  try {
    const bid = await rpcAcceptBid(db, cardId, "platform_vault", null);
    return c.json({ ok: true, bid });
  } catch (err) {
    if (err instanceof RpcError) {
      const status = err.code === "FORBIDDEN" || err.code === "CARD_NOT_TRADABLE" ? 403 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
});

export default app;
