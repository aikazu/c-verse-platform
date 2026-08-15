import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { isDbEnabled, RpcError, rpcCheckout, userDb } from "../lib/db.js";
import { getDropById } from "../lib/reads/drops.js";
import { getCardById, getOrderById, listOrdersByUser, listShipmentsByCards } from "../lib/reads/orders.js";
import { getWalletByUser } from "../lib/reads/profile.js";
import { mapOrderRow, mapShipmentRow, type Row, readDb } from "../lib/reads.js";
import type { Card } from "../lib/store.js";
import { addTx, awardBadgeIfNeeded, ensureSeed, ensureWallet, logAudit, nowIso, store, uid } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

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
    const user = authRes.user;

    const body = c.req.valid("json");
    const dropId = body.dropId;
    // Postgres wired: atomic RPC (docs/13) — single transaction, no read-check-write JS.
    if (isDbEnabled()) {
      const db = userDb(authRes.token);
      if (db) {
        const pool = body.variant === "signed" ? "premium" : "regular";
        try {
          const order = await rpcCheckout(db, {
            dropId,
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
      }
    }
    // docs/07 C-10 FINAL: vault is DEFAULT — keep schema default; do not override to shipping
    const deliveryOption = body.deliveryOption ?? "vault";
    const shippingAddress = body.shippingAddress ?? null;
    const shippingFeeCcoin = body.shippingFeeCcoin ?? null;

    if (deliveryOption === "shipping" && (!shippingAddress || shippingAddress.trim().length < 10)) {
      return c.json({ error: "Alamat pengiriman wajib (min 10 karakter) untuk opsi kirim fisik" }, 400);
    }
    if (deliveryOption === "shipping" && (shippingFeeCcoin == null || shippingFeeCcoin < 1)) {
      return c.json({ error: "Ongkir (C-Coin integer ≥ 1) wajib untuk kirim fisik" }, 400);
    }

    const drop = store.drops.get(dropId);
    if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);
    if (drop.status !== "live" && drop.status !== "published") return c.json({ error: `Drop belum live (status: ${drop.status})` }, 400);

    const remaining = drop.totalUnits - drop.soldCount;
    if (remaining < 1) return c.json({ error: "Unit sudah habis" }, 400);

    // Limit: 1 kartu / user / drop (docs/05-data-model I3)
    const already = [...store.orders.values()].find((o) => o.userId === user.id && o.dropId === dropId);
    if (already) return c.json({ error: "Kamu sudah memiliki kartu dari drop ini (limit 1 kartu/user/drop)" }, 400);

    const priceCcoin = drop.priceCcoin ?? drop.priceUnsignedCCoin;
    const totalCcoin = priceCcoin + (deliveryOption === "shipping" ? (shippingFeeCcoin as number) : 0);

    const w = ensureWallet(user.id);
    if (w.balanceCCoin < totalCcoin) {
      return c.json(
        {
          error: "Saldo C-Coin tidak cukup",
          needCCoin: totalCcoin,
          haveCCoin: w.balanceCCoin,
          needIdr: totalCcoin * C_COIN_RATE_IDR,
          topupHint: `Top-up minimal ${totalCcoin - w.balanceCCoin} C-Coin`,
        },
        402,
      );
    }

    // Signed allocation random 1:10 per docs 03 Flow 1 + 09 2.5: sistem random assign signed/unsigned saat debit
    // Pool remaining signed vs unsigned separately; pick random within available pool proportional to remaining
    const available = [...store.cards.values()]
      .filter((ca) => ca.dropId === dropId && ca.status === "available" && ca.location === "platform_stock")
      .sort((a, b) => a.unitNumber - b.unitNumber);
    if (available.length === 0) return c.json({ error: "Stok tidak tersedia — unit habis atau terkunci" }, 400);
    // Random pick: if both variant pools remain, ~10% chance prefer signed pool else unsigned; fallthrough to available
    const signedAvail = available.filter((c) => c.variant === "signed");
    const unsignedAvail = available.filter((c) => c.variant === "unsigned");
    let card: (typeof available)[number];
    if (signedAvail.length > 0 && unsignedAvail.length > 0) {
      card =
        Math.random() < 0.1
          ? signedAvail[Math.floor(Math.random() * signedAvail.length)]
          : unsignedAvail[Math.floor(Math.random() * unsignedAvail.length)];
    } else {
      card = available[Math.floor(Math.random() * available.length)];
    }

    // Atomik: allocate + wallet
    card.status = "sold";
    card.location = deliveryOption === "vault" ? "platform_vault" : "with_owner";
    card.ownerId = user.id;
    card.qcStatus = "passed"; // for MVP; real flow: QC step before ship
    drop.soldCount += 1;
    if (drop.soldCount >= drop.totalUnits) drop.status = "sold_out";

    const note =
      deliveryOption === "vault"
        ? `Checkout ${drop.title} #${card.unitNumber} — ${priceCcoin} C-Coin (simpan di vault)`
        : `Checkout ${drop.title} #${card.unitNumber} — ${priceCcoin} C-Coin + ongkir ${shippingFeeCcoin} C-Coin`;
    addTx(user.id, "checkout", -totalCcoin, "order", `chk-${Date.now()}`, note);

    // Revenue share platform-produced 70/30 credited to creator hold (disburse batch Selasa H+1)
    const creatorShare = Math.floor(priceCcoin * 0.3);
    if (creatorShare > 0 && drop.creatorId !== user.id) {
      ensureWallet(drop.creatorId);
      addTx(drop.creatorId, "royalty", creatorShare, "order", card.id, `Revenue share 30% — ${drop.title} #${card.unitNumber}`);
      // docs 07 C-05c: XP only via spend + badge reward — royalty did not accrue spend XP to recipient;
      // creator's XP grows when THEY spend, not when receiving share. No totalXp bump here.
    }

    const orderId = uid("ord-");
    const trackingNumber =
      deliveryOption === "shipping"
        ? `JNE-${Math.floor(Math.random() * 1e12)
            .toString()
            .padStart(12, "0")}`
        : null;
    const order = {
      id: orderId,
      userId: user.id,
      dropId,
      cardIds: [card.id],
      cardId: card.id,
      totalCCoin: totalCcoin,
      totalIdr: totalCcoin * C_COIN_RATE_IDR,
      status: (deliveryOption === "vault" ? "settled" : "paid") as typeof store.orders extends Map<string, infer V>
        ? V extends { status: infer S }
          ? S
          : never
        : never,
      deliveryOption,
      shippingFeeCcoin: deliveryOption === "shipping" ? (shippingFeeCcoin as number) : null,
      escrowStatus: deliveryOption === "vault" ? "released" : "held",
      shippingAddress: deliveryOption === "shipping" ? (shippingAddress as string) : null,
      trackingNumber,
      shippedAt: null,
      deliveredAt: null,
      createdAt: nowIso(),
    } as unknown as Parameters<typeof store.orders.set>[1];
    store.orders.set(orderId, order as never);

    // Shipment record
    const shipId = uid("ship-");
    store.shipments.set(shipId, {
      id: shipId,
      cardId: card.id,
      requesterId: user.id,
      type: deliveryOption === "vault" ? "primary_vault" : "primary_shipping",
      fromLocation: "platform",
      toDest: deliveryOption === "vault" ? "platform_vault" : "buyer_address",
      address: deliveryOption === "shipping" ? ({ street: shippingAddress } as unknown as string) : null,
      feeCcoin: deliveryOption === "shipping" ? (shippingFeeCcoin as number) : null,
      status: deliveryOption === "vault" ? "delivered" : "requested",
      trackingNumber,
      platformCheck: null,
      createdAt: nowIso(),
    });

    store.ownershipHistory.push({
      id: uid("oh-"),
      cardId: card.id,
      ownerId: user.id,
      acquiredVia: "primary",
      orderId,
      bidId: null,
      transferredAt: nowIso(),
    });

    // Badges / XP already handled via addTx + award
    if (!store.userBadges.find((ub) => ub.userId === user.id && ub.badgeId === "b1")) {
      awardBadgeIfNeeded(user.id, "b1");
    }
    const { evaluateBadges } = await import("../lib/store.js");
    evaluateBadges(user.id);

    // Guard max 1 unit sold log already covered

    return c.json(
      {
        order,
        cards: [card],
        wallet: { ...ensureWallet(user.id), balanceIdrEquiv: ensureWallet(user.id).balanceCCoin * C_COIN_RATE_IDR },
        shipmentId: shipId,
      },
      201,
    );
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
  const drop = await getDropById(o.dropId);
  const cards = (await Promise.all((o.cardIds ?? []).map((id) => getCardById(id)))).filter((ca): ca is Card => ca != null);
  const shipments = await listShipmentsByCards(o.cardIds ?? []);
  return c.json({ order: o, drop: drop ?? undefined, cards, shipments });
});

app.post("/:id/confirm-delivered", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  // DB path: direct table write (non-money columns only)
  if (isDbEnabled()) {
    const db = readDb();
    if (db) {
      const { data, error } = await db
        .from("orders")
        .update({ status: "delivered", delivered_at: nowIso(), escrow_status: "released" }) // MVP immediate; real is DELIVERED + H+7
        .eq("id", c.req.param("id"))
        .eq("user_id", user.id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return c.json({ error: "Order tidak ditemukan" }, 404);
      return c.json({ order: mapOrderRow(data as Row) });
    }
  }
  const o = store.orders.get(c.req.param("id")) as unknown as Record<string, unknown> & { userId: string; status: string };
  if (!o || o.userId !== user.id) return c.json({ error: "Order tidak ditemukan" }, 404);
  (o as unknown as Record<string, unknown>).status = "delivered";
  (o as unknown as Record<string, unknown>).deliveredAt = nowIso();
  (o as unknown as Record<string, unknown>).escrowStatus = "released"; // MVP immediate; real is DELIVERED + H+7
  logAudit(
    user.id,
    "update",
    "orders",
    o.id as string,
    { status: "delivered" },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ order: o });
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
    // DB path: cards + shipments via direct table writes (non-money); ongkir debit stays RPC (wallet_debit).
    if (isDbEnabled()) {
      const db = readDb();
      if (db) {
        const card = await getCardById(cardId);
        if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
        if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
        if (card.location !== "platform_vault") return c.json({ error: "Kartu tidak di vault — tidak perlu ship-from-vault" }, 400);
        const wallet = await getWalletByUser(user.id);
        if (wallet.balanceCCoin < feeCcoin)
          return c.json({ error: "Saldo C-Coin tidak cukup untuk ongkir", needCCoin: feeCcoin, haveCCoin: wallet.balanceCCoin }, 402);
        // Money rule (docs/13): saldo C-Coin only via RPC — wallet_debit is the existing atomic RPC.
        const rpcClient = userDb(authRes.token);
        if (!rpcClient) throw new Error("Supabase RPC client unavailable");
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
        // Mirror store semantics: only qc flips; location stays platform_vault until delivered.
        const { error: cardError } = await db.from("cards").update({ qc_status: "passed" }).eq("id", cardId);
        if (cardError) throw new Error(cardError.message);
        const walletAfter = await getWalletByUser(user.id);
        return c.json({
          ok: true,
          shipment: mapShipmentRow(shipRow as Row),
          card: { ...card, qcStatus: "passed" as const },
          wallet: { ...walletAfter, balanceIdrEquiv: walletAfter.balanceCCoin * C_COIN_RATE_IDR },
        });
      }
    }
    const card = store.cards.get(cardId);
    if (!card) return c.json({ error: "Kartu tidak ditemukan" }, 404);
    if (card.ownerId !== user.id) return c.json({ error: "Kamu bukan pemilik kartu ini" }, 403);
    if (card.location !== "platform_vault") return c.json({ error: "Kartu tidak di vault — tidak perlu ship-from-vault" }, 400);
    const w = ensureWallet(user.id);
    if (w.balanceCCoin < feeCcoin)
      return c.json({ error: "Saldo C-Coin tidak cukup untuk ongkir", needCCoin: feeCcoin, haveCCoin: w.balanceCCoin }, 402);
    addTx(user.id, "checkout", -feeCcoin, "shipment", cardId, `Ongkir vault shipout ${card.nfcShortId} — ${feeCcoin} C-Coin`);
    const shipId = uid("ship-");
    const tracking = `JNE-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, "0")}`;
    store.shipments.set(shipId, {
      id: shipId,
      cardId,
      requesterId: user.id,
      type: "vault_shipout",
      fromLocation: "platform",
      toDest: "buyer_address",
      address: { street: address } as unknown as string,
      feeCcoin,
      status: "shipped",
      trackingNumber: tracking,
      platformCheck: null,
      createdAt: nowIso(),
    });
    // Don't flip location until delivered; mark pending ship
    card.qcStatus = "passed";
    logAudit(
      user.id,
      "create",
      "shipments",
      shipId,
      { cardId, feeCcoin },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    return c.json({
      ok: true,
      shipment: store.shipments.get(shipId),
      card,
      wallet: { ...ensureWallet(user.id), balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR },
    });
  },
);

export default app;
