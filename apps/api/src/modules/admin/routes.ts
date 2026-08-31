import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, clientIp, requireAdmin, tokenFingerprint } from "../../lib/auth.js";
import { RpcError, rpcCancelSeedSale, rpcReleaseSeedSale } from "../../lib/db.js";
import { type EmailBindings, sendCreatorAccessEmail } from "../../lib/email.js";
import { sanitizeDbError } from "../../lib/errors.js";
import { logAuditDb } from "../../lib/reads/kyc.js";
import { readDb } from "../../lib/reads.js";
import { uid } from "../../lib/store.js";
import { getSupabase } from "../../lib/supabase.js";

// Admin mutations (role-gated; jalankan server-side dengan service-role client).
// Reads tetap via Supabase RLS di admin SPA — mutasi sensitif (role/suspend/dispute)
// WAJIB lewat sini agar ter-audit di admin_audit_log (append-only).

// Env slice typed to EmailBindings so handlers can pass `c.env` into the email
// module — the EMAIL binding / EMAIL_FROM var exist only on the Workers env.
const app = new Hono<{ Bindings: EmailBindings }>();

// GET /audit — admin baca audit log (RLS deny utk authenticated; API = service-role)
app.get("/audit", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
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
    const authRes = await requireAdmin(c);
    if ("error" in authRes) {
      const e = adminGateError(authRes);
      return c.json(e.body, e.status);
    }
    const admin = authRes.user;
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
    if (error) return c.json({ error: sanitizeDbError(error) }, 400);
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
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );
    return c.json({ user: data });
  },
);

// PATCH /users/:id/wallet-hold — fraud hold payout (hold_payout_until)
app.patch("/users/:id/wallet-hold", zValidator("json", z.object({ holdPayoutUntil: z.string().nullable() })), async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const admin = authRes.user;
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
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  await logAuditDb(
    admin.id,
    "update",
    "wallets",
    c.req.param("id"),
    { holdPayoutUntil: parsed?.toISOString() ?? null },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ wallet: data });
});

// GET /disputes — admin list semua dispute
app.get("/disputes", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
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
    const authRes = await requireAdmin(c);
    if ("error" in authRes) {
      const e = adminGateError(authRes);
      return c.json(e.body, e.status);
    }
    const admin = authRes.user;
    const { status, decisionNotes } = c.req.valid("json");
    const db = getSupabase();
    const { data, error } = await db
      .from("disputes")
      .update({ status, decision_notes: decisionNotes ?? null })
      .eq("id", c.req.param("id"))
      .select()
      .maybeSingle();
    if (error) return c.json({ error: sanitizeDbError(error) }, 400);
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
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );
    return c.json({ dispute: data });
  },
);

// POST /users/provision — buat akun kreator admin-provisioned (FINAL 2026-08-20).
// Alur: create auth user (tanpa password, email_confirm) -> trigger buat row
// public.users -> set role='creator' -> insert creators -> audit log -> email akses.
app.post(
  "/users/provision",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      displayName: z.string().min(1).max(120),
      handle: z.string().min(1).max(60),
      totalFollowersCombined: z.number().int().min(0).optional(),
      notes: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireAdmin(c);
    if ("error" in authRes) {
      const e = adminGateError(authRes);
      return c.json(e.body, e.status);
    }
    const admin = authRes.user;
    const { email, displayName, handle, totalFollowersCombined, notes } = c.req.valid("json");
    const db = getSupabase();

    // Cek duplikat eksplisit (lebih ramah daripada error unik) — email kanonik
    // juga dicek DB via unique index users_canonical_email_uidx.
    const { data: dup } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (dup) return c.json({ error: "Email sudah terdaftar" }, 409);

    // 1) Auth user tanpa password — trigger `on_auth_user_created` membuat row public.users.
    const created = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: displayName, role: "creator" },
    });
    if (created.error) {
      const msg = created.error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("exists") || msg.includes("registered") || msg.includes("duplicate")) {
        return c.json({ error: "Email sudah terdaftar" }, 409);
      }
      return c.json({ error: sanitizeDbError(created.error) }, 400);
    }
    const uidNew = created.data.user.id;

    // 2) Role + display name (trigger default role='user').
    const { error: userErr } = await db.from("users").update({ role: "creator", display_name: displayName }).eq("id", uidNew);
    // Lane E (audit 2026-08-31): raw Postgres text tidak pernah di-echo ke klien.
    if (userErr) return c.json({ error: sanitizeDbError(userErr) }, 400);

    // 3) Row creators (handle unique). Handle bentrok -> rollback best-effort:
    // hapus auth user agar tidak ada akun yatim, lalu 409.
    const creatorId = uid("cr-");
    const { error: creatorErr } = await db.from("creators").insert({
      id: creatorId,
      user_id: uidNew,
      handle,
      total_followers_combined: totalFollowersCombined ?? 0,
      status: "active",
      notes: notes ?? null,
    });
    if (creatorErr) {
      const msg = creatorErr.message.toLowerCase();
      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("handle")) {
        try {
          await db.auth.admin.deleteUser(uidNew);
        } catch (rollbackErr) {
          console.error("[admin] rollback deleteUser gagal:", rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
        }
        return c.json({ error: "Handle sudah dipakai" }, 409);
      }
      try {
        await db.auth.admin.deleteUser(uidNew);
      } catch (rollbackErr) {
        console.error("[admin] rollback deleteUser gagal:", rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
      }
      return c.json({ error: sanitizeDbError(creatorErr) }, 400);
    }

    // 4) Email akses (flag EMAIL_ENABLED default OFF di dev -> { sent:false, reason:'disabled' }).
    // `c.env` wajib: binding EMAIL + EMAIL_FROM hanya ada di Workers env (module syntax).
    const emailResult = await sendCreatorAccessEmail({ to: email, displayName }, c.env);

    // 5) Audit log — action 'create' valid (enum audit_action).
    await logAuditDb(
      admin.id,
      "create",
      "users",
      uidNew,
      { provision: true, handle, emailSent: emailResult.sent },
      clientIp(c),
      await tokenFingerprint(c.req.header("authorization")),
    );

    return c.json({ user: { id: uidNew, email, role: "creator" }, creator: { handle }, emailSent: emailResult.sent }, 201);
  },
);

// ── Creator Seed C.Card vault-in (Flow 10 langkah [8], keputusan 2026-08-20) ──
// PATCH /cards/:id/vault-in — admin menandai KEDATANGAN FISIK kartu ke vault
// platform (location -> 'platform_vault'), prasyarat RELEASE seed card
// (release_seed_sale, two-phase settlement 2026-08-21).
//
// KEPUTUSAN DESAIN (akses aman, tidak memalsukan verified NFC):
// gate RELEASE seed di RPC release_seed_sale (04_rpc.sql — sebelumnya
// 20260821020000_seed_two_phase) mengecek KEDUA syarat: (a) cards.location
// = 'platform_vault' (fisik ada di vault — penilaian admin/ops) DAN
// (b) cards.verify_status = 'verified' (UID cocok — HANYA dari tap NFC
// via apps/api/src/modules/nfc/routes.ts, CMAC crypto yang tidak bisa dipalsu).
// Endpoint ini hanya memenuhi (a) + mencatat pemeriksaan kondisi fisik
// ke audit; verify_status 'verified' TIDAK PERNAH di-set di sini —
// kalau belum verified via NFC, release_seed_sale tetap menolak hingga
// tap NFC sukses. Dengan begitu admin tidak bisa memalsukan keaslian kartu.
app.patch("/cards/:id/vault-in", zValidator("json", z.object({ physicalCheckNote: z.string().max(2000).optional() })), async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const admin = authRes.user;
  const cardId = c.req.param("id");
  const db = getSupabase();
  const { data: existing } = await db.from("cards").select("id, location, verify_status, drop_id").eq("id", cardId).maybeSingle();
  if (!existing) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  // Gate: vault-in hanya untuk Creator Seed C.Card (docs 07 C-12/15,
  // keputusan 2026-08-21). Kartu non-seed tidak pernah masuk vault —
  // owner langsung pegang atau kirim.
  const { data: drop } = await db.from("drops").select("is_seed").eq("id", existing.drop_id).maybeSingle();
  if (!drop?.is_seed) {
    return c.json({ error: "Kartu bukan Creator Seed C.Card", code: "NOT_SEED_CARD" }, 400);
  }
  const { data, error } = await db
    .from("cards")
    .update({ location: "platform_vault" })
    .eq("id", cardId)
    .select("id, location, verify_status, drop_id")
    .maybeSingle();
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  const { physicalCheckNote } = c.req.valid("json");
  await logAuditDb(
    admin.id,
    "update",
    "cards",
    cardId,
    {
      action: "vault_in",
      location: "platform_vault",
      // verify_status tidak diubah di sini — verified hanya via tap NFC (nfc.ts).
      verify_status_untouched: existing.verify_status,
      physicalCheckNote: physicalCheckNote ?? null,
      from: existing.location,
    },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ card: data });
});

// ── Creator Seed C.Card PHASE-2 settlement (Flow 10, keputusan 2026-08-21) ──
// POST /cards/:id/release-seed-sale — admin memicu RELEASE/settlement
// two-phase seed sale (service_role-only RPC, bukan aksi user):
// seller 85% + royalti kreator 7,5% + platform 7,5% + ownership -> buyer +
// shipment. Prasyarat (di RPC): card.status='bid_pending' (transaksi seed
// berjalan) DAN kartu fisik SUDAH di vault (location='platform_vault' via
// PATCH vault-in) + NFC verified (verify_status='verified' — HANYA dari tap
// crypto nfc.ts, tidak bisa dipalsukan) -> selain itu RPC raise
// SEED_VAULT_IN_REQUIRED (409) / NO_PENDING_SALE (409) / NOT_SEED_CARD (400).
app.post("/cards/:id/release-seed-sale", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const admin = authRes.user;
  const cardId = c.req.param("id");
  const db = getSupabase();
  const { data: existing } = await db.from("cards").select("id, status, location, verify_status, drop_id").eq("id", cardId).maybeSingle();
  if (!existing) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  try {
    await rpcReleaseSeedSale(db, cardId);
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "SEED_VAULT_IN_REQUIRED" || err.code === "NO_PENDING_SALE") {
        return c.json({ error: err.message }, 409);
      }
      if (err.code === "NOT_SEED_CARD") {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: err.message }, 400);
    }
    // Lane E (audit 2026-08-31): non-RpcError catch-all tidak meng-echo raw text.
    return c.json({ error: sanitizeDbError(err instanceof Error ? err : { message: String(err) }) }, 400);
  }
  await logAuditDb(
    admin.id,
    "update",
    "cards",
    cardId,
    {
      action: "release_seed_sale",
      status_before: existing.status,
      location: existing.location,
      verify_status: existing.verify_status,
    },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ ok: true, cardId });
});

// ── Creator Seed C.Card PHASE-1 ABORT (admin, keputusan 2026-08-23) ──
// POST /cards/:id/cancel-seed-sale — admin membatalkan transaksi PHASE-1
// yang STUCK (kartu hilang / dispute / tidak pernah di-vault-in).
// Buyer di-refund FULL (no fees, no XP — XP granted TEPAT SEKALI di
// PHASE-2 release per invariant founder 2026-08-23). Path A (accepted-bid):
// bid 'accepted' -> 'cancelled' + wallet_credit buyer; Path B (order
// pending buyout PHASE-1): order 'paid' -> 'refunded' + wallet_credit.
// service_role only RPC (cancel_seed_sale, mirror guard pattern dari
// release_seed_sale di 04_rpc.sql — sebelumnya 20260823030000). TIDAK touch
// treasury / platform_revenue — PHASE-1 menulis tidak ada revenue leg.
app.post("/cards/:id/cancel-seed-sale", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const admin = authRes.user;
  const cardId = c.req.param("id");
  const db = getSupabase();
  const { data: existing } = await db.from("cards").select("id, status, location, verify_status, drop_id").eq("id", cardId).maybeSingle();
  if (!existing) return c.json({ error: "Kartu tidak ditemukan" }, 404);
  let summary: Record<string, unknown> = {};
  try {
    summary = (await rpcCancelSeedSale(db, cardId)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "NO_PENDING_SALE") {
        return c.json({ error: err.message }, 409);
      }
      if (err.code === "NOT_SEED_CARD") {
        return c.json({ error: err.message }, 400);
      }
      if (err.code === "PERMISSION_DENIED") {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: err.message }, 400);
    }
    // Lane E (audit 2026-08-31): non-RpcError catch-all tidak meng-echo raw text.
    return c.json({ error: sanitizeDbError(err instanceof Error ? err : { message: String(err) }) }, 400);
  }
  await logAuditDb(
    admin.id,
    "update",
    "cards",
    cardId,
    {
      action: "seed_sale_abort",
      status_before: existing.status,
      location: existing.location,
      verify_status: existing.verify_status,
      refundedCcoin: summary.refundedCcoin ?? null,
      buyerId: summary.buyerId ?? null,
      path: summary.path ?? null,
      alreadyAborted: summary.alreadyAborted ?? false,
    },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ ok: true, cardId, ...summary });
});

export default app;
