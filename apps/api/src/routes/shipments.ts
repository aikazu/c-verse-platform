import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { getDropById } from "../lib/reads/drops.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { getCardById, getShipmentById, listShipmentsByRequester } from "../lib/reads/orders.js";
import { mapShipmentRow, type Row, readDb } from "../lib/reads.js";

const app = new Hono();

// Shipments: list my shipments
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const mine = await listShipmentsByRequester(user.id);
  return c.json({ shipments: mine });
});

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

// Admin: update tracking/status (fulfillment)
app.patch(
  "/:id/status",
  zValidator(
    "json",
    z.object({ status: z.enum(["requested", "packed", "shipped", "delivered", "cancelled"]), trackingNumber: z.string().optional() }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    const user = "error" in authRes ? null : authRes.user;
    if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const { status, trackingNumber } = c.req.valid("json");
    // direct table writes (non-money) — shipments + cards.location + orders.tracking_number when relevant.
    const db = readDb();
    const existing = await getShipmentById(c.req.param("id"));
    if (!existing) return c.json({ error: "Not found" }, 404);
    const patch: Record<string, unknown> = { status };
    if (trackingNumber) patch.tracking_number = trackingNumber;
    const { data, error } = await db.from("shipments").update(patch).eq("id", c.req.param("id")).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: "Not found" }, 404);
    if (status === "delivered") {
      const { error: cardError } = await db.from("cards").update({ location: "with_owner" }).eq("id", existing.cardId);
      if (cardError) throw new Error(cardError.message);
    }
    if (trackingNumber) {
      const { error: orderError } = await db.from("orders").update({ tracking_number: trackingNumber }).eq("card_id", existing.cardId);
      if (orderError) throw new Error(orderError.message);
    }
    await logAuditDb(
      user.id,
      "update",
      "shipments",
      existing.id,
      { status },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    return c.json({ shipment: mapShipmentRow(data as Row) });
  },
);

export default app;
