import { timingSafeEqual } from "node:crypto";
import { BALANCE_CAP_CCOIN, C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, requireAdmin, requireUser, tokenFingerprint } from "../lib/auth.js";
import { RpcError, rpcPayoutRefund, userDb } from "../lib/db.js";
import { getProvider } from "../lib/payments/index.js";
import { mapTransactionStatus } from "../lib/payments/midtrans.js";
import { getKycByUser, logAuditDb } from "../lib/reads/kyc.js";
import { getWalletByUser } from "../lib/reads/profile.js";
import { randomHex } from "../lib/store.js";
import { getSupabase } from "../lib/supabase.js";

// Payments (docs/14): uang masuk HANYA via webhook terverifikasi signature —
// bukan dari redirect browser. Kredit saldo via RPC wallet_credit (idempotent by order_id).

const app = new Hono();

function newOrderId(userId: string): string {
  const rand = randomHex(3);
  return `top-${userId}-${Math.floor(Date.now() / 1000)}-${rand}`;
}

function parseTopupOrderId(orderId: string): { userId: string } | null {
  const m = orderId.match(/^top-([0-9a-fA-F-]{36})-\d+-[a-z0-9]+$/);
  return m ? { userId: m[1] } : null;
}

app.post("/topup", zValidator("json", z.object({ amountCcoin: z.number().int().min(1).max(10000) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const { amountCcoin } = c.req.valid("json");

  // Cap saldo non-KYC (docs 07 C-08, founder 2026-08-16): top-up akan melampaui
  // 500 C-Coin ditolak sampai KYC approved (tanpa cap setelahnya).
  const [wallet, kyc] = await Promise.all([getWalletByUser(user.id), getKycByUser(user.id)]);
  if (kyc?.status !== "approved" && wallet.balanceCCoin + amountCcoin > BALANCE_CAP_CCOIN) {
    return c.json(
      {
        error: `Cap saldo non-KYC ${BALANCE_CAP_CCOIN} C-Coin (saldo sekarang ${wallet.balanceCCoin}). Selesaikan KYC (/me/kyc) untuk membuka tanpa cap.`,
        code: "KYC_TOPUP_CAP",
        needKyc: true,
      },
      422,
    );
  }

  const provider = await getProvider();
  if (!provider) {
    return c.json({ error: "Payment gateway belum terkonfigurasi (set MIDTRANS_SERVER_KEY)" }, 503);
  }

  const orderId = newOrderId(user.id);
  const instruction = await provider.createTopup({
    orderId,
    amountIdr: amountCcoin * C_COIN_RATE_IDR,
    amountCcoin,
    userId: user.id,
  });
  return c.json({ orderId, provider: provider.name, amountCcoin, amountIdr: amountCcoin * C_COIN_RATE_IDR, ...instruction }, 201);
});

// POST /payout — creator minta disbursement: dana dikunci (debit), row payouts
// pending dibuat; batch mingguan (payout_batch_run) + webhook IRIS menyelesaikan.
app.post("/payout", zValidator("json", z.object({ amountCcoin: z.number().int().min(1) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { amountCcoin } = c.req.valid("json");
  const db = userDb(authRes.token);
  const { data, error } = await db.rpc("payout_request", { p_amount: amountCcoin });
  if (error) {
    const code = error.message.trim().split("\n")[0];
    const status =
      code === "KYC_REQUIRED" ? 403 : code === "PAYOUT_HELD" ? 423 : code === "INSUFFICIENT" ? 402 : code === "MIN_PAYOUT" ? 400 : 400;
    const messages: Record<string, string> = {
      KYC_REQUIRED: "KYC harus disetujui dulu sebelum payout (ajukan di /me/kyc)",
      PAYOUT_HELD: "Payout sedang ditahan admin (fraud hold)",
      INSUFFICIENT: "Saldo C-Coin tidak cukup",
      MIN_PAYOUT: "Payout minimum 10 C-Coin",
    };
    return c.json({ error: messages[code] ?? error.message, code }, status);
  }
  return c.json({ payout: data }, 201);
});

// POST /admin/payout-run — admin trigger batch payout mingguan (manual override cron).
app.post("/admin/payout-run", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const user = authRes.user;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("payout_batch_run");
  if (error) return c.json({ error: error.message }, 500);
  await logAuditDb(
    user.id,
    "payout_trigger",
    "payout_batches",
    String(data ?? "-"),
    { batchId: data },
    c.req.header("x-forwarded-for") ?? null,
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ batchId: data });
});

// POST /admin/payouts/:id/refund — admin mengembalikan dana payout yang terkunci
// ke wallet kreator saat disbursement tidak/belum terjadi (founder 2026-08-23:
// disbursement manual via dashboard IRIS; refund endpoint untuk failed/aborted).
// RPC payout_refund mengunci row, tolak status disbursed/refunded, kredit wallet
// via wallet_credit (idempotent), set status 'refunded'.
app.post("/admin/payouts/:id/refund", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const e = adminGateError(authRes);
    return c.json(e.body, e.status);
  }
  const admin = authRes.user;
  const payoutId = c.req.param("id");
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("payouts").select("id, status, user_id, ccoin_amount").eq("id", payoutId).maybeSingle();
  if (!existing) return c.json({ error: "Payout tidak ditemukan" }, 404);
  try {
    const refunded = await rpcPayoutRefund(supabase, payoutId);
    await logAuditDb(
      admin.id,
      "payout_refund",
      "payouts",
      payoutId,
      {
        action: "payout_refund",
        status_before: existing.status,
        status_after: refunded.status ?? "refunded",
        user_id: existing.user_id,
        ccoin_amount: existing.ccoin_amount,
      },
      c.req.header("x-forwarded-for") ?? null,
      await tokenFingerprint(c.req.header("authorization")),
    );
    return c.json({ payout: refunded });
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "NOT_FOUND") return c.json({ error: "Payout tidak ditemukan" }, 404);
      if (err.code === "INVALID_STATE") return c.json({ error: err.message }, 409);
      return c.json({ error: err.message }, 400);
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/midtrans/webhook", async (c) => {
  const provider = await getProvider();
  if (!provider) return c.json({ error: "Not configured" }, 503);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = {
    orderId: String(body.order_id ?? ""),
    statusCode: String(body.status_code ?? ""),
    grossAmount: String(body.gross_amount ?? ""),
    status: String(body.transaction_status ?? ""),
    signatureKey: body.signature_key as string | undefined,
    paymentType: body.payment_type as string | undefined,
    raw: body,
  };
  // 1. Signature salah -> 401, tidak kredit
  if (!payload.orderId || !provider.verifyNotification(payload)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const supabase = getSupabase();
  if (!supabase) return c.json({ error: "DB not configured" }, 503);

  const parsed = parseTopupOrderId(payload.orderId);
  if (!parsed) {
    console.warn("[payments] webhook order_id tidak dikenal:", payload.orderId.slice(0, 8));
    return c.json({ ok: true, ignored: true });
  }

  // 2. Jangan percaya body webhook — ambil status via API
  let status = payload.status;
  try {
    const remote = await provider.getStatus(payload.orderId);
    status = remote.status;
  } catch (err) {
    console.warn("[payments] getStatus gagal, pakai body webhook:", (err as Error).message);
  }

  // 3. Map status; 4. Sukses -> wallet_credit idempotent (idempotency_key = order_id)
  const mapped = mapTransactionStatus(status);
  if (mapped !== "success") {
    return c.json({ ok: true, status: mapped }); // pending ditunggu; fail tidak kredit
  }

  // Konversi IDR -> C-Coin SELALU ceil (docs 07 C-11 — Math.round melanggar spek).
  const amountCcoin = Math.ceil(Number(payload.grossAmount) / C_COIN_RATE_IDR);
  if (!Number.isInteger(amountCcoin) || amountCcoin < 1) {
    return c.json({ ok: true, ignored: true });
  }

  const { data, error } = await supabase.rpc("wallet_credit", {
    p_user: parsed.userId,
    p_amount: amountCcoin,
    p_type: "top_up",
    p_ref_type: "top_up",
    p_ref_id: payload.orderId,
    p_idem: payload.orderId,
  });
  if (error) {
    // Cap non-KYC tercapai (race double top-up): jangan bikin Midtrans retry selamanya —
    // akui webhook + audit trail untuk rekonsiliasi manual (refund via Midtrans).
    if (error.message.includes("TOPUP_CAP_EXCEEDED")) {
      await logAuditDb(
        "system",
        "view_sensitive",
        "wallet_transactions",
        payload.orderId,
        { fraud: "topup_cap_exceeded", userId: parsed.userId, amountCcoin },
        null,
        null,
      );
      console.error("[payments] topup melewati cap non-KYC (race) — kredit ditolak, perlu refund manual:", payload.orderId);
      return c.json({ ok: true, ignored: true, reason: "topup_cap_exceeded" });
    }
    return c.json({ error: error.message }, 500);
  }
  // duplicate notification -> RPC idempotent: saldo TIDAK dobel
  return c.json({ ok: true, credited: amountCcoin, idempotentReplay: (data as { amount_ccoin?: number } | null) === null });
});

app.post("/midtrans/payout-webhook", async (c) => {
  const signingKey =
    (globalThis as unknown as Record<string, string | undefined>).PAYOUT_WEBHOOK_SIGNING_KEY ??
    (typeof process !== "undefined" ? process.env?.PAYOUT_WEBHOOK_SIGNING_KEY : undefined);
  if (!signingKey) return c.json({ error: "Not configured" }, 503);

  const signature = c.req.header("x-signature-key");
  // Constant-time compare (anti timing-attack), konsisten dengan verifyNotificationSignature.
  const sigBuf = signature ? Buffer.from(signature, "utf8") : null;
  const keyBuf = Buffer.from(signingKey, "utf8");
  if (!sigBuf || sigBuf.length !== keyBuf.length || !timingSafeEqual(sigBuf, keyBuf)) {
    return c.json({ error: "Invalid signature" }, 401);
  }
  const supabase = getSupabase();
  if (!supabase) return c.json({ error: "DB not configured" }, 503);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const payoutId = String(body.payout_id ?? body.ref ?? "");
  const status = String(body.status ?? "").toLowerCase();
  if (!payoutId) return c.json({ ok: true, ignored: true });

  const next = status === "paid" ? "disbursed" : status === "failed" ? "failed" : null;
  if (!next) return c.json({ ok: true, ignored: true });

  const { error } = await supabase.from("payouts").update({ status: next }).eq("id", payoutId);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, payoutId, status: next });
});

export default app;
