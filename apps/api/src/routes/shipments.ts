import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, uid, nowIso, logAudit } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}
function requireAdmin(c: typeof app extends Hono<infer _> ? never : never): never { throw new Error("unused"); }

// Shipments: list my shipments
app.get("/", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const mine = [...store.shipments.values()].filter((s) => s.requesterId === user.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ shipments: mine });
});

app.get("/:id", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const s = store.shipments.get(c.req.param("id"));
  if (!s) return c.json({ error: "Shipment tidak ditemukan" }, 404);
  if (s.requesterId !== user.id && (user.role as string) !== "admin") return c.json({ error: "Forbidden" }, 403);
  return c.json({ shipment: s, card: store.cards.get(s.cardId), drop: store.cards.get(s.cardId) ? store.drops.get(store.cards.get(s.cardId)!.dropId) : null });
});

// Admin: update tracking/status (fulfillment)
app.patch(
  "/:id/status",
  zValidator("json", z.object({ status: z.enum(["requested", "packed", "shipped", "delivered", "cancelled"]), trackingNumber: z.string().optional() })),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const s = store.shipments.get(c.req.param("id"));
    if (!s) return c.json({ error: "Not found" }, 404);
    const { status, trackingNumber } = c.req.valid("json");
    s.status = status as typeof s.status;
    if (trackingNumber) s.trackingNumber = trackingNumber;
    if (status === "delivered") {
      const card = store.cards.get(s.cardId);
      if (card) card.location = "with_owner";
    }
    logAudit(user.id, "update", "shipments", s.id, { status }, c.req.header("x-forwarded-for") ?? null, authHeaderToToken(c.req.header("authorization")) ?? null);
    return c.json({ shipment: s });
  },
);

export default app;
