import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { awardBadgeIfNeededDb, getKycByUser, listKycRecords, logAuditDb, setKycStatus, upsertKycSubmission } from "../lib/reads/kyc.js";
import { ensureSeed } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const rec = await getKycByUser(user.id);
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
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const body = c.req.valid("json");
    const existing = await getKycByUser(user.id);
    if (existing && existing.status === "approved") return c.json({ error: "KYC sudah approved" }, 400);
    const rec = await upsertKycSubmission(user.id, existing, { fullName: body.fullName, nik: body.nik, address: body.address });
    return c.json({ kyc: rec }, 201);
  },
);

app.post("/:id/approve", async (c) => {
  const authRes = await requireUser(c);
  const user = "error" in authRes ? null : authRes.user;
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = await setKycStatus(c.req.param("id"), "approved");
  if (!rec) return c.json({ error: "Not found" }, 404);
  // Side effect: badge "verified" (store id b6) + XP reward, once per user
  await awardBadgeIfNeededDb(rec.userId, "verified");
  await logAuditDb(
    user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "approved" },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ kyc: rec });
});

app.post("/:id/reject", async (c) => {
  const authRes = await requireUser(c);
  const user = "error" in authRes ? null : authRes.user;
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const rec = await setKycStatus(c.req.param("id"), "rejected");
  if (!rec) return c.json({ error: "Not found" }, 404);
  await logAuditDb(
    user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "rejected" },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ kyc: rec });
});

app.get("/admin/all", async (c) => {
  const authRes = await requireUser(c);
  const user = "error" in authRes ? null : authRes.user;
  if (!user || (user.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  return c.json({ kyc: await listKycRecords() });
});

export default app;
