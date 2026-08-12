import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, uid, nowIso } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) { return getUserByToken(authHeaderToToken(c.req.header("authorization"))); }

app.get("/", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const rec = [...store.kyc.values()].find(k => k.userId === user.id);
  return c.json({ kyc: rec || null });
});

app.post("/", zValidator("json", z.object({
  fullName: z.string().min(2).max(100),
  nik: z.string().length(16),
  address: z.string().min(10).max(500),
  dob: z.string().optional(),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = c.req.valid("json");
  const existing = [...store.kyc.values()].find(k => k.userId === user.id);
  if (existing && existing.status === "approved") return c.json({ error: "KYC sudah approved" }, 400);
  const id = existing?.id ?? uid("kyc-");
  const rec = { id, userId: user.id, fullName: body.fullName, nik: body.nik, address: body.address, status: "pending" as const, createdAt: existing?.createdAt ?? nowIso() };
  store.kyc.set(id, rec);
  // Auto-approve for MVP demo (admin review simulation: approve after 1s via polling, but for now instant pending → admin can approve)
  return c.json({ kyc: rec }, 201);
});

app.post("/:id/approve", async (c) => {
  const user = requireAuth(c);
  if (!user || user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = store.kyc.get(c.req.param("id"));
  if (!rec) return c.json({ error: "Not found" }, 404);
  rec.status = "approved";
  // Badge verified
  const owner = store.users.get(rec.userId);
  if (owner && !store.userBadges.find(ub => ub.userId === owner.id && ub.badgeId === "b6")) {
    store.userBadges.push({ userId: owner.id, badgeId: "b6", earnedAt: nowIso() });
    owner.xp += 50;
  }
  return c.json({ kyc: rec });
});

app.post("/:id/reject", async (c) => {
  const user = requireAuth(c);
  if (!user || user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = store.kyc.get(c.req.param("id"));
  if (!rec) return c.json({ error: "Not found" }, 404);
  rec.status = "rejected";
  return c.json({ kyc: rec });
});

app.get("/admin/all", async (c) => {
  const user = requireAuth(c);
  if (!user || user.role !== "admin") return c.json({ error: "Hanya admin" }, 403);
  return c.json({ kyc: [...store.kyc.values()] });
});

export default app;
