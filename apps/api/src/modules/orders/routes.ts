import { checkoutSchema, SHIPMENT_FEE_CCOIN } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { clientIp, requireUser, tokenFingerprint } from "../../lib/auth.js";
import { RpcError, rpcCheckout, rpcVaultShipout, userDb } from "../../lib/db.js";
import { sanitizeDbError } from "../../lib/errors.js";
import { getDropById, listCardsByIds } from "../../lib/reads/drops.js";
import { logAuditDb } from "../../lib/reads/kyc.js";
import { getOrderById, listOrdersByUser, listShipmentsByCards } from "../../lib/reads/orders.js";
import { readDb } from "../../lib/reads.js";
import { uid } from "../../lib/store.js";

const app = new Hono();

// ── Checkout (primary sale — 1 kartu per checkout, 1 kartu/user/drop) ─────
// Founder 2026-08-28: settle LANGSUNG ke vault — tanpa alamat/ongkir di titik
// beli. Shipping = flow pasca-vault via POST /orders/vault-shipout.
app.post("/checkout", zValidator("json", checkoutSchema), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);

  const body = c.req.valid("json");
  // atomic RPC (docs/13) — single transaction, no read-check-write JS.
  const db = userDb(authRes.token);
  try {
    const order = await rpcCheckout(db, body.dropId, body.pool);
    return c.json({ order, wallet: null, dbPath: "rpc" }, 201);
  } catch (err) {
    if (err instanceof RpcError) {
      const status = err.code === "INSUFFICIENT" ? 402 : err.code === "AUTH_REQUIRED" ? 401 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
});

// List orders mine
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const orders = await listOrdersByUser(user.id);
  return c.json({ orders });
});

app.get("/:id", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const o = await getOrderById(c.req.param("id"));
  if (!o) return c.json({ error: "Order tidak ditemukan" }, 404);
  if (o.userId !== user.id && (user.role as string) !== "admin") return c.json({ error: "Forbidden" }, 403);
  const [drop, cards, shipments] = await Promise.all([
    getDropById(o.dropId),
    listCardsByIds(o.cardIds ?? []),
    listShipmentsByCards(o.cardIds ?? []),
  ]);
  return c.json({ order: o, drop: drop ?? undefined, cards, shipments });
});

// POST /:id/dispute — buyer buka dispute untuk order miliknya (admin putuskan via /api/admin/disputes/:id)
// Founder 2026-08-28: semua order baru settle langsung ke vault — gate HANYA
// memblok `refunded` agar dispute tetap bisa dibuka untuk order settled.
app.post("/:id/dispute", zValidator("json", z.object({ reason: z.string().min(10).max(2000) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const id = c.req.param("id");
  const { reason } = c.req.valid("json");
  const existing = await getOrderById(id);
  if (!existing) return c.json({ error: "Order tidak ditemukan" }, 404);
  if (existing.userId !== user.id) return c.json({ error: "Forbidden" }, 403);
  if (existing.status === "refunded") {
    return c.json({ error: `Order sudah refunded — tidak bisa dibuka dispute` }, 409);
  }
  const db = readDb();
  const disputeId = uid("dsp-");
  const { error } = await db.from("disputes").insert({
    id: disputeId,
    order_id: id,
    card_id: existing.cardId ?? null,
    reporter_id: user.id,
    reason,
    status: "open",
  });
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  await logAuditDb(
    user.id,
    "create",
    "disputes",
    disputeId,
    { orderId: id },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ dispute: { id: disputeId, orderId: id, status: "open" } }, 201);
});

// Ship from vault (any vault-held card owned by caller, even without order context)
// Founder 2026-08-28: atomic RPC `vault_shipout` — shipment insert + fee debit
// (treasury + platform_revenue ref_type 'shipment') single transaction di SQL.
// Fee = konstanta server SHIPMENT_FEE_CCOIN, di-derive di dalam RPC (audit
// 2026-08-31: fee client-supplied underchargable) — body hanya {cardId, address};
// ownership/active-shipment check di dalam RPC (race-safe).
app.post("/vault-shipout", zValidator("json", z.object({ cardId: z.string().min(1), address: z.string().min(10).max(500) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const { cardId, address } = c.req.valid("json");
  const db = userDb(authRes.token);
  try {
    const shipment = await rpcVaultShipout(db, cardId, address);
    // Tracking number diisi admin via PATCH /api/shipments/:id/status saat benar-benar dikirim.
    await logAuditDb(
      user.id,
      "create",
      "shipments",
      String((shipment as { id?: string }).id ?? cardId),
      { cardId, feeCcoin: SHIPMENT_FEE_CCOIN },
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );
    return c.json({ ok: true, shipment }, 200);
  } catch (err) {
    if (err instanceof RpcError) {
      const status = err.code === "INSUFFICIENT" ? 402 : err.code === "AUTH_REQUIRED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
});

export default app;
