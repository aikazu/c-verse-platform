import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, uid, nowIso, awardBadgeIfNeeded, logAudit } from "../lib/store.js";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}

app.get("/", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const rec = [...store.kyc.values()].find((k) => k.userId === user.id);
  return c.json({ kyc: rec || null });
});

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      fullName: z.string().min(2).max(100),
      nik: z.string().length(16),
      address: z.string().min(10).max(500),
      dob: z.string().optional(),
      npwpUrl: z.string().optional(),
      selfieUrl: z.string().optional(),
    }),
  ),
  async (c) => {
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const body = c.req.valid("json");
    const existing = [...store.kyc.values()].find((k) => k.userId === user.id);
    if (existing && existing.status === "approved") return c.json({ error: "KYC sudah approved" }, 400);
    const id = existing?.id ?? uid("kyc-");
    const rec = {
      id,
      userId: user.id,
      fullName: body.fullName,
      nik: body.nik,
      address: body.address,
      status: "pending" as const,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    } as unknown as Parameters<typeof store.kyc.set>[1];
    store.kyc.set(id, rec as never);
    return c.json({ kyc: rec }, 201);
  },
);

app.post("/:id/approve", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = store.kyc.get(c.req.param("id")) as unknown as { status: string; userId: string } & Record<string, unknown>;
  if (!rec) return c.json({ error: "Not found" }, 404);
  (rec as unknown as Record<string, unknown>).status = "approved";
  const owner = store.users.get((rec as unknown as { userId: string }).userId);
  if (owner) awardBadgeIfNeeded(owner.id, "b6");
  logAudit(user.id, "update", "kyc_records", c.req.param("id"), { status: "approved" }, c.req.header("x-forwarded-for") ?? null, authHeaderToToken(c.req.header("authorization")) ?? null);
  return c.json({ kyc: rec });
});

app.post("/:id/reject", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = store.kyc.get(c.req.param("id")) as unknown as Record<string, unknown> | undefined;
  if (!rec) return c.json({ error: "Not found" }, 404);
  (rec as Record<string, unknown>).status = "rejected";
  logAudit(user.id, "update", "kyc_records", c.req.param("id"), { status: "rejected" }, c.req.header("x-forwarded-for") ?? null, authHeaderToToken(c.req.header("authorization")) ?? null);
  return c.json({ kyc: rec });
});

app.get("/admin/all", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  return c.json({ kyc: [...store.kyc.values()] });
});

export default app;
