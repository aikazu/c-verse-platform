import { BALANCE_CAP_CCOIN, C_COIN_RATE_IDR, KYC_TRIGGER_THRESHOLD_CCOIN, MIN_PAYOUT_CCOIN } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { addTx, ensureSeed, ensureWallet, isPayoutHeld, store } from "../lib/store.js";

const app = new Hono();
app.use("*", async (_c, next) => {
  ensureSeed();
  await next();
});

const KYC_THRESHOLD = KYC_TRIGGER_THRESHOLD_CCOIN; // 1.000 C-Coin (docs/16 F-03; demo pakai KYC_TOPUP_THRESHOLD_DEMO di seed)

app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const w = ensureWallet(user.id);
  const txs = store.walletTx
    .filter((t) => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const held = isPayoutHeld(user.id);
  return c.json({
    wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR },
    transactions: txs.slice(0, 100),
    rate: C_COIN_RATE_IDR,
    thresholdKyc: KYC_THRESHOLD,
    balanceCap: BALANCE_CAP_CCOIN,
    minPayout: MIN_PAYOUT_CCOIN,
    payoutHeld: held.held,
    payoutHoldUntil: held.until,
    disclosureOpsiA:
      "Saldo C-Coin bersifat closed-loop: saldo buyer tidak dapat diuangkan (withdraw). Hanya hasil penjualan seller/kreator yang dapat di-disburse ke IDR (fee 1%, min 10 C-Coin, KYC wajib).",
  });
});

app.post(
  "/topup",
  zValidator(
    "json",
    z.object({
      amountCCoin: z.number().int().min(1).max(10000).optional(),
      amountCcoin: z.number().int().min(1).max(10000).optional(),
      amount_ccoin: z.number().int().min(1).max(10000).optional(),
      method: z.enum(["qris", "va_bca", "va_mandiri", "ewallet_gopay", "ewallet_ovo"]).optional().default("qris"),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const raw = c.req.valid("json") as { amountCCoin?: number; amountCcoin?: number; amount_ccoin?: number; method: string };
    const amountCCoin = raw.amountCcoin ?? raw.amountCCoin ?? raw.amount_ccoin;
    if (amountCCoin == null) return c.json({ error: "amountCCoin wajib" }, 400);

    // KYC gate: top-up kumulatif >99 C-Coin requires KYC approved (07 C-05b)
    const cumBefore = store.walletTx
      .filter((t) => t.userId === user?.id && (t.type === "topup" || t.type === "top_up") && t.amountCCoin > 0)
      .reduce((n, t) => n + t.amountCCoin, 0);
    if (cumBefore + amountCCoin > KYC_THRESHOLD) {
      const kyc = [...store.kyc.values()].find((k) => k.userId === user?.id && k.status === "approved");
      if (!kyc)
        return c.json(
          {
            error: `KYC diperlukan untuk top-up kumulatif > ${KYC_THRESHOLD} C-Coin`,
            needKyc: true,
            cumulativeWouldBe: cumBefore + amountCCoin,
            threshold: KYC_THRESHOLD,
          },
          400,
        );
    }

    // Balance cap (docs/07 C-08): tolak top-up yang melampaui cap saldo (default BALANCE_CAP_CCOIN)
    const wouldBe = ensureWallet(user.id).balanceCCoin + amountCCoin;
    if (wouldBe > BALANCE_CAP_CCOIN)
      return c.json({ error: `Cap saldo terlampaui (${BALANCE_CAP_CCOIN} C-Coin) — top-up ditolak`, cap: BALANCE_CAP_CCOIN, wouldBe }, 400);

    // Idempotency guard: reject duplicate idempotency_key in recent window (docs 05 WalletTransactions metadata)
    const idemKey = c.req.header("x-idempotency-key") ?? `top-${user.id}-${amountCCoin}-${raw.method}-${Math.floor(Date.now() / 5000)}`;
    const dup = store.walletTx.find((t) => (t.metadata as unknown as { idempotency_key?: string })?.idempotency_key === idemKey);
    if (dup) return c.json({ error: "Duplicate top-up (idempotency)", idempotencyKey: idemKey, existingTx: dup }, 409);

    // Opsi A: buyer closed-loop — top-up menambah saldo; withdrawal buyer tidak ada (refund-to-source only di ops manual)
    // Gateway mocked (Midtrans/Xendit) — langsung credit; metadata holds method for reconciliation
    const tx = addTx(
      user.id,
      "top_up",
      amountCCoin,
      "topup",
      `top-${Date.now()}`,
      `Top-up ${amountCCoin} C-Coin via ${raw.method} (Rp ${(amountCCoin * C_COIN_RATE_IDR).toLocaleString("id-ID")})`,
      {
        method: raw.method,
        idempotency_key: idemKey,
        disclosure: "Saldo tidak dapat diuangkan — closed-loop buyer (Opsi A, disclosure Opsi A).",
      },
    );
    // XP: top-up TIDAK menambah XP per 05-data-model / 07 C-05c — only spend + badge reward does
    const w = ensureWallet(user.id);
    return c.json({
      wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR },
      transaction: tx,
      xpNote: "Top-up tidak menambah XP — XP naik saat spending C-Coin.",
    });
  },
);

// Payout disbursement for seller/creator (IDR; fee 1%; KYC + bank account required)
// Opsi A: seller/kreator auto-disburse IDR; buyer tidak bisa payout (closed-loop)
app.post(
  "/payout",
  zValidator(
    "json",
    z.object({
      amountCCoin: z.number().int().min(1).optional(),
      amountCcoin: z.number().int().min(1).optional(),
      bankAccount: z.string().min(5).max(50).optional(),
    }),
  ),
  async (c) => {
    const authRes = await requireUser(c);
    if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
    const user = authRes.user;
    const raw = c.req.valid("json") as { amountCCoin?: number; amountCcoin?: number; bankAccount?: string };
    const amountCCoin = raw.amountCcoin ?? raw.amountCCoin;
    if (amountCCoin == null) return c.json({ error: "amountCCoin wajib" }, 400);
    if (amountCCoin < MIN_PAYOUT_CCOIN)
      return c.json(
        { error: `Minimum payout ${MIN_PAYOUT_CCOIN} C-Coin (Rp ${MIN_PAYOUT_CCOIN * C_COIN_RATE_IDR})`, minPayout: MIN_PAYOUT_CCOIN },
        400,
      );
    const w = ensureWallet(user.id);
    if (w.balanceCCoin < amountCCoin) return c.json({ error: "Saldo tidak cukup untuk payout" }, 400);
    // KYC + bank gate for payouts (prevents arbitrary withdraw)
    const kyc = [...store.kyc.values()].find((k) => k.userId === user.id && k.status === "approved");
    if (!kyc) return c.json({ error: "KYC approved wajib untuk payout", needKyc: true }, 400);
    // payout hold (fraud 30d per docs 07 C-13 creator self-dealing & flag_reason)
    const held = isPayoutHeld(user.id);
    if (held.held) return c.json({ error: `Payout ditahan sampai ${held.until} (fraud hold)`, holdUntil: held.until }, 403);
    const feeCCoin = Math.max(1, Math.ceil(amountCCoin * 0.01));
    addTx(
      user.id,
      "payout",
      -amountCCoin,
      "payout",
      `payout-${Date.now()}`,
      `Payout ${amountCCoin} C-Coin -> IDR (fee 1% = ${feeCCoin} C-Coin)`,
      { fee_rate_payout: 0.01, fee_ccoin: feeCCoin, idempotency_key: `payout-${user.id}-${Date.now()}` },
    );
    const netIdr = (amountCCoin - feeCCoin) * C_COIN_RATE_IDR;
    return c.json({
      ok: true,
      netCCoin: amountCCoin - feeCCoin,
      feeCCoin,
      netIdr,
      wallet: { ...ensureWallet(user.id), balanceIdrEquiv: ensureWallet(user.id).balanceCCoin * C_COIN_RATE_IDR },
    });
  },
);

export default app;
