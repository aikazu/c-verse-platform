import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, clientIp, requireAdmin, requireUser, tokenFingerprint } from "../lib/auth.js";
import { getKycByUser, listKycRecords, logAuditDb, setKycStatus, upsertKycSubmission } from "../lib/reads/kyc.js";

const app = new Hono();

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
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const user = authRes.user;
  const rec = await setKycStatus(c.req.param("id"), "approved");
  if (!rec) return c.json({ error: "Not found" }, 404);
  // Badge "verified" + XP di-award OLEH TRIGGER badge_on_kyc (sekali, idempotent) —
  // jangan ulangi di JS (double XP fix 2026-08-16).
  await logAuditDb(
    user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "approved" },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ kyc: rec });
});

app.post("/:id/reject", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const user = authRes.user;
  const rec = await setKycStatus(c.req.param("id"), "rejected");
  if (!rec) return c.json({ error: "Not found" }, 404);
  await logAuditDb(
    user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "rejected" },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ kyc: rec });
});

app.get("/admin/all", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  return c.json({ kyc: await listKycRecords() });
});

export default app;
