import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { logAuditDb } from "../lib/reads/kyc.js";
import { readDb } from "../lib/reads.js";
import { getSupabase } from "../lib/supabase.js";

// Admin mutations (role-gated; jalankan server-side dengan service-role client).
// Reads tetap via Supabase RLS di admin SPA — mutasi sensitif (role/suspend/dispute)
// WAJIB lewat sini agar ter-audit di admin_audit_log (append-only).

const app = new Hono();

// GET /audit — admin baca audit log (RLS deny utk authenticated; API = service-role)
app.get("/audit", async (c) => {
  const authRes = await requireUser(c);
  const admin = "error" in authRes ? null : authRes.user;
  if (!admin || (admin.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const db = readDb();
  const limit = Math.min(500, Math.max(10, Number(c.req.query("limit") || 100)));
  const { data, error } = await db.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return c.json({ audit: data ?? [] });
});

// PATCH /users/:id — promote/demote role + suspend/unsuspend (flag_reason).
app.patch(
  "/users/:id",
  zValidator(
    "json",
    z.object({
      role: z.enum(["user", "creator", "admin"]).optional(),
      flagReason: z.string().max(500).nullable().optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    const admin = "error" in authRes ? null : authRes.user;
    if (!admin || (admin.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const { role, flagReason } = c.req.valid("json");
    if (role == null && flagReason === undefined) return c.json({ error: "role atau flagReason wajib" }, 400);
    if (c.req.param("id") === admin.id && (role != null || (flagReason != null && flagReason !== ""))) {
      return c.json({ error: "Tidak boleh mengubah role/suspend akun sendiri" }, 400);
    }
    const patch: Record<string, unknown> = {};
    if (role != null) patch.role = role;
    if (flagReason !== undefined) patch.flag_reason = flagReason === "" ? null : flagReason;
    const db = getSupabase();
    const { data, error } = await db
      .from("users")
      .update(patch)
      .eq("id", c.req.param("id"))
      .select("id, display_name, role, flag_reason")
      .maybeSingle();
    if (error) return c.json({ error: error.message }, 400);
    if (!data) return c.json({ error: "User tidak ditemukan" }, 404);
    // Promote creator -> aktifkan row creators kalau ada (apply 'inactive' -> 'active')
    if (role === "creator") {
      await db.from("creators").update({ status: "active" }).eq("user_id", c.req.param("id"));
    }
    await logAuditDb(
      admin.id,
      "update",
      "users",
      String(data.id),
      { role, flagReason: flagReason ?? null },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    return c.json({ user: data });
  },
);

// PATCH /users/:id/wallet-hold — fraud hold payout (hold_payout_until)
app.patch("/users/:id/wallet-hold", zValidator("json", z.object({ holdPayoutUntil: z.string().nullable() })), async (c) => {
  const authRes = await requireUser(c);
  const admin = "error" in authRes ? null : authRes.user;
  if (!admin || (admin.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const { holdPayoutUntil } = c.req.valid("json");
  const parsed = holdPayoutUntil === null ? null : new Date(holdPayoutUntil);
  if (holdPayoutUntil !== null && (!parsed || !Number.isFinite(parsed.getTime()))) {
    return c.json({ error: "holdPayoutUntil tidak valid (ISO) atau null" }, 400);
  }
  const db = getSupabase();
  const { data, error } = await db
    .from("wallets")
    .upsert({ user_id: c.req.param("id"), hold_payout_until: parsed?.toISOString() ?? null }, { onConflict: "user_id" })
    .select("user_id, hold_payout_until")
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  await logAuditDb(
    admin.id,
    "update",
    "wallets",
    c.req.param("id"),
    { holdPayoutUntil: parsed?.toISOString() ?? null },
    c.req.header("x-forwarded-for") ?? null,
    c.req.header("authorization") ?? null,
  );
  return c.json({ wallet: data });
});

// GET /disputes — admin list semua dispute
app.get("/disputes", async (c) => {
  const authRes = await requireUser(c);
  const admin = "error" in authRes ? null : authRes.user;
  if (!admin || (admin.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
  const db = readDb();
  const { data, error } = await db.from("disputes").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return c.json({ disputes: data ?? [] });
});

// PATCH /disputes/:id — admin putuskan dispute (refund/strike/suspend)
app.patch(
  "/disputes/:id",
  zValidator(
    "json",
    z.object({
      status: z.enum(["under_review", "resolved_refund", "resolved_strike", "resolved_suspend"]),
      decisionNotes: z.string().max(2000).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    const admin = "error" in authRes ? null : authRes.user;
    if (!admin || (admin.role as string) !== "admin") return c.json({ error: "Hanya admin" }, 403);
    const { status, decisionNotes } = c.req.valid("json");
    const db = getSupabase();
    const { data, error } = await db
      .from("disputes")
      .update({ status, decision_notes: decisionNotes ?? null })
      .eq("id", c.req.param("id"))
      .select()
      .maybeSingle();
    if (error) return c.json({ error: error.message }, 400);
    if (!data) return c.json({ error: "Dispute tidak ditemukan" }, 404);
    // resolved_suspend -> suspend user pelaku (reporter bukan target; target = user_order)
    if (status === "resolved_suspend") {
      const orderId = (data as { order_id?: string | null }).order_id;
      if (orderId) {
        const { data: order } = await db.from("orders").select("user_id").eq("id", orderId).maybeSingle();
        if (order)
          await db
            .from("users")
            .update({ flag_reason: `dispute:${c.req.param("id")}` })
            .eq("id", order.user_id);
      }
    }
    await logAuditDb(
      admin.id,
      "update",
      "disputes",
      c.req.param("id"),
      { status, decisionNotes: decisionNotes ?? null },
      c.req.header("x-forwarded-for") ?? null,
      c.req.header("authorization") ?? null,
    );
    return c.json({ dispute: data });
  },
);

export default app;
