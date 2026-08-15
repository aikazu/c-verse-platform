import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
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
  const orders = [...store.orders.values()]
    .filter((o) => o.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ orders });
});

app.get("/:id", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const o = store.orders.get(c.req.param("id")) as unknown as { userId: string; dropId: string; cardIds: string[] } & Record<
    string,
    unknown
  >;
  if (!o) return c.json({ error: "Order tidak ditemukan" }, 404);
  if ((o as unknown as { userId: string }).userId !== user.id && (user.role as string) !== "admin")
    return c.json({ error: "Forbidden" }, 403);
  const drop = store.drops.get((o as unknown as { dropId: string }).dropId);
  const cards = ((o as unknown as { cardIds: string[] }).cardIds ?? []).map((id) => store.cards.get(id)).filter(Boolean);
  const shipments = [...store.shipments.values()].filter((s) => (o as unknown as { cardIds: string[] }).cardIds?.includes(s.cardId));
  return c.json({ order: o, drop, cards, shipments });
});

app.post("/:id/confirm-delivered", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
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
