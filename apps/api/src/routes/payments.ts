import { timingSafeEqual } from "node:crypto";
import { C_COIN_RATE_IDR } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { getProvider } from "../lib/payments/index.js";
import { mapTransactionStatus } from "../lib/payments/midtrans.js";
import { getSupabase } from "../lib/supabase.js";

// Payments (docs/14): uang masuk HANYA via webhook terverifikasi signature —
// bukan dari redirect browser. Kredit saldo via RPC wallet_credit (idempotent by order_id).

const app = new Hono();

function newOrderId(userId: string): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `top-${userId}-${Math.floor(Date.now() / 1000)}-${rand}`;
}

function parseTopupOrderId(orderId: string): { userId: string } | null {
  const m = orderId.match(/^top-([0-9a-fA-F-]{36})-\d+-[a-z0-9]+$/);
  return m ? { userId: m[1] } : null;
}

app.post("/topup", zValidator("json", z.object({ amountCcoin: z.number().int().min(1).max(10000) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { amountCcoin } = c.req.valid("json");

  const provider = await getProvider();
  if (!provider) {
    return c.json({ error: "Payment gateway belum terkonfigurasi (dev: gunakan /api/wallet/topup)" }, 503);
  }

  const orderId = newOrderId(authRes.user.id);
  const instruction = await provider.createTopup({
    orderId,
    amountIdr: amountCcoin * C_COIN_RATE_IDR,
    amountCcoin,
    userId: authRes.user.id,
  });
  return c.json({ orderId, provider: provider.name, amountCcoin, amountIdr: amountCcoin * C_COIN_RATE_IDR, ...instruction }, 201);
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

  const amountCcoin = Math.round(Number(payload.grossAmount) / C_COIN_RATE_IDR);
  if (!Number.isInteger(amountCcoin) || amountCcoin < 1) {
    return c.json({ ok: true, ignored: true });
  }

  const { data, error } = await supabase.rpc("wallet_credit", {
    p_user: parsed.userId,
    p_amount: amountCcoin,
    p_type: "top_up",
    p_ref_type: "topup",
    p_ref_id: payload.orderId,
    p_idem: payload.orderId,
  });
  if (error) return c.json({ error: error.message }, 500);
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
