import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { RpcError, rpcCheckout, userDb } from "../lib/db.js";
import { getDropById, listCardsByIds } from "../lib/reads/drops.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { getCardById, getOrderById, listOrdersByUser, listShipmentsByCards } from "../lib/reads/orders.js";
import { getWalletByUser } from "../lib/reads/profile.js";
import { mapOrderRow, mapShipmentRow, type Row, readDb } from "../lib/reads.js";
import { nowIso, uid } from "../lib/store.js";

const app = new Hono();

// ── Checkout (primary sale — 1 kartu per checkout, 1 kartu/user/drop) ─────
// Delivery: shipping (alamat + ongkir integer >=1) atau vault (no alamat/tracking)
app.post(
  "/checkout",
  zValidator(
    "json",
    z.object({
      dropId: z.string().min(1),
      deliveryOption: z.enum(["shipping", "vault"]).default("vault"),
      shippingFeeCcoin: z.number().int().min(1).nullable().optional(),
      shippingAddress: z.string().min(10).max(500).nullable().optional(),
      // legacy compat
      quantity: z.number().int().min(1).max(1).optional(),
      variant: z.enum(["unsigned", "signed"]).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);

    const body = c.req.valid("json");
    // atomic RPC (docs/13) — single transaction, no read-check-write JS.
    const db = userDb(authRes.token);
    const pool = body.variant === "signed" ? "premium" : "regular";
    try {
      const order = await rpcCheckout(db, {
        dropId: body.dropId,
        pool,
        delivery: body.deliveryOption ?? "vault",
        address: body.shippingAddress ?? null,
        shippingFee: body.shippingFeeCcoin ?? null,
      });
      return c.json({ order, wallet: null, dbPath: "rpc" }, 201);
    } catch (err) {
      if (err instanceof RpcError) {
        const status = err.code === "INSUFFICIENT" ? 402 : err.code === "AUTH_REQUIRED" ? 401 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  },
);

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

app.post("/:id/confirm-delivered", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  // direct table write (non-money columns only)
  const db = readDb();
  const { data, error } = await db
    .from("orders")
    .update({ status: "delivered", delivered_at: nowIso(), escrow_status: "released" }) // MVP immediate; real is DELIVERED + H+7
    .eq("id", c.req.param("id"))
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return c.json({ error: "Order tidak ditemukan" }, 404);
  await logAuditDb(
    user.id,
    "update",
    "orders",
    String(data.id),
    { status: "delivered" },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ order: mapOrderRow(data as Row) });
});

// Ship from vault (any vault-held card owned by caller, even without order context)
app.post(
  "/vault-shipout",
  zValidator("json", z.object({ cardId: z.string().min(1), address: z.string().min(10).max(500), feeCcoin: z.number().int().min(1) })),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const { cardId, address, feeCcoin } = c.req.valid("json");
    // cards + shipments via direct table writes (non-money); ongkir debit stays RPC (wallet_debit).
    const db = readDb();
    const card = await getCardById(cardId);
    if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
    if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
    if (card.location !== "platform_vault") return c.json({ error: "Kartu tidak di vault — tidak perlu ship-from-vault" }, 400);
    const wallet = await getWalletByUser(user.id);
    if (wallet.balanceCCoin < feeCcoin)
      return c.json({ error: "Saldo C-Coin tidak cukup untuk ongkir", needCCoin: feeCcoin, haveCCoin: wallet.balanceCCoin }, 402);
    // Money rule (docs/13): saldo C-Coin only via RPC — wallet_debit is the existing atomic RPC.
    const rpcClient = userDb(authRes.token);
    const { error: debitError } = await rpcClient.rpc("wallet_debit", {
      p_user: user.id,
      p_amount: feeCcoin,
      p_type: "checkout",
      p_ref_type: "shipment",
      p_ref_id: cardId,
      p_idem: `vault-shipout-${cardId}-${Date.now()}`,
    });
    if (debitError) {
      const code = debitError.message.trim().split("\n")[0];
      if (code === "INSUFFICIENT")
        return c.json({ error: "Saldo C-Coin tidak cukup untuk ongkir", needCCoin: feeCcoin, haveCCoin: wallet.balanceCCoin }, 402);
      throw new Error(debitError.message);
    }
    const shipId = uid("ship-");
    const tracking = `JNE-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, "0")}`;
    const { data: shipRow, error: shipError } = await db
      .from("shipments")
      .insert({
        id: shipId,
        card_id: cardId,
        requester_id: user.id,
        type: "vault_shipout",
        from_location: "platform",
        to_dest: "buyer_address",
        address: { street: address },
        fee_ccoin: feeCcoin,
        status: "shipped",
        tracking_number: tracking,
        platform_check: null,
      })
      .select("*")
      .maybeSingle();
    if (shipError) throw new Error(shipError.message);
    if (!shipRow) throw new Error("Shipment insert returned no row");
    // Mirror semantics: only qc flips; location stays platform_vault until delivered.
    const { error: cardError } = await db.from("cards").update({ qc_status: "passed" }).eq("id", cardId);
    if (cardError) throw new Error(cardError.message);
    await logAuditDb(
      user.id,
      "create",
      "shipments",
      shipId,
      { cardId, feeCcoin },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    const walletAfter = await getWalletByUser(user.id);
    return c.json({
      ok: true,
      shipment: mapShipmentRow(shipRow as Row),
      card: { ...card, qcStatus: "passed" as const },
      wallet: { ...walletAfter, balanceIdrEquiv: walletAfter.balanceCCoin * C_COIN_RATE_IDR },
    });
  },
);

export default app;
