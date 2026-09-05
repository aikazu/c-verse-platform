import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, clientIp, requireAdmin, requireUser, tokenFingerprint } from "../../lib/auth.js";
import { RpcError, rpcAdminFulfillShipment, rpcSellerToVault, userDb } from "../../lib/db.js";
import { getDropById } from "../../lib/reads/drops.js";
import { logAuditDb } from "../../lib/reads/kyc.js";
import { getCardById, getShipmentById, listShipmentsByRequester } from "../../lib/reads/orders.js";
import { mapShipmentRow, type Row } from "../../lib/reads.js";
import { getSupabase } from "../../lib/supabase.js";

const app = new Hono();

// Shipments: list my shipments
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const mine = await listShipmentsByRequester(user.id);
  return c.json({ shipments: mine });
});

// Returning a card locks custody and queues the shipment in one transaction.
app.post(
  "/seller-to-vault",
  zValidator(
    "json",
    z.object({
      cardId: z.string().min(1),
      address: z.string().min(10).max(500),
      trackingNumber: z.string().min(3).max(120).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const { cardId, address, trackingNumber } = c.req.valid("json");
    try {
      const shipment = await rpcSellerToVault(userDb(authRes.token), cardId, address, trackingNumber ?? null);
      await logAuditDb(
        authRes.user.id,
        "create",
        "shipments",
        String(shipment.id),
        { cardId, type: "secondary_seller_to_vault" },
        clientIp(c),
        await tokenFingerprint(c.req.header("authorization")),
      );
      return c.json({ ok: true, shipment: mapShipmentRow(shipment as Row) }, 201);
    } catch (err) {
      if (err instanceof RpcError) {
        const status =
          err.code === "CARD_NOT_FOUND"
            ? 404
            : err.code === "FORBIDDEN"
              ? 403
              : ["SHIPMENT_ACTIVE", "SALE_IN_PROGRESS", "INVALID_TRANSITION"].includes(err.code)
                ? 409
                : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  },
);

app.get("/:id", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const s = await getShipmentById(c.req.param("id"));
  if (!s) return c.json({ error: "Shipment tidak ditemukan" }, 404);
  if (s.requesterId !== user.id && (user.role as string) !== "admin") return c.json({ error: "Forbidden" }, 403);
  const card = await getCardById(s.cardId);
  const drop = card ? await getDropById(card.dropId) : null;
  return c.json({ shipment: s, card: card ?? undefined, drop: drop ?? undefined });
});

// Admin: update tracking/status (fulfillment). State mutation dilakukan atomik
// via RPC admin_fulfill_shipment (shipments + orders + cards dalam satu transaksi).
// Precheck transisi tetap di route untuk respons 409 yang ramah sebelum roundtrip DB.
const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  requested: ["packed", "shipped", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

app.patch(
  "/:id/status",
  zValidator(
    "json",
    z.object({ status: z.enum(["requested", "packed", "shipped", "delivered", "cancelled"]), trackingNumber: z.string().optional() }),
  ),
  async (c) => {
    const authRes = await requireAdmin(c);
    if ("error" in authRes) {
      const e = adminGateError(authRes);
      return c.json(e.body, e.status);
    }
    const user = authRes.user;
    const { status, trackingNumber } = c.req.valid("json");
    // Precheck 1: shipment ada & preflight transisi (respons cepat, RPC juga memvalidasi).
    const existing = await getShipmentById(c.req.param("id"));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!SHIPMENT_TRANSITIONS[existing.status]?.includes(status)) {
      return c.json({ error: `Transisi tidak valid: ${existing.status} -> ${status}` }, 409);
    }
    // Mutasi atomik: shipment + order + card (jika relevan) dalam satu transaksi SQL.
    const supabase = getSupabase();
    try {
      const data = await rpcAdminFulfillShipment(supabase, existing.id, status, trackingNumber ?? null);
      await logAuditDb(
        user.id,
        "update",
        "shipments",
        existing.id,
        { status, trackingNumber: trackingNumber ?? null },
        clientIp(c),
        await tokenFingerprint(c.req.header("authorization")),
      );
      return c.json({ shipment: mapShipmentRow(data as Row) });
    } catch (err) {
      if (err instanceof RpcError) {
        if (err.code === "NOT_FOUND") return c.json({ error: "Tidak ditemukan" }, 404);
        if (err.code === "INVALID_TRANSITION") {
          return c.json({ error: err.message }, 409);
        }
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  },
);

export default app;
