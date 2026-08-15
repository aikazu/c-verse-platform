import { BALANCE_CAP_CCOIN, C_COIN_RATE_IDR, KYC_TRIGGER_THRESHOLD_CCOIN, MIN_PAYOUT_CCOIN } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../lib/auth.js";
import { getWallet, isPayoutHeld, listWalletTxs } from "../lib/reads/wallet.js";

const app = new Hono();

const KYC_THRESHOLD = KYC_TRIGGER_THRESHOLD_CCOIN; // 1.000 C-Coin (docs/16 F-03; demo pakai KYC_TOPUP_THRESHOLD_DEMO di seed)

app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const w = await getWallet(user.id);
  const txs = await listWalletTxs(user.id, 100);
  const held = await isPayoutHeld(user.id);
  return c.json({
    wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR },
    transactions: txs,
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

// Real-money path (docs/14): top-up hanya via Midtrans webhook — endpoint demo in-memory dihapus.
app.post("/topup", zValidator("json", z.object({}).passthrough()), async (_c) =>
  _c.json({ error: "Top-up via Midtrans (/api/payments/topup)" }, 503),
);

// Payout disbursement berjalan via admin batch — self-service debit demo in-memory dihapus.
app.post("/payout", zValidator("json", z.object({}).passthrough()), async (_c) => _c.json({ error: "Payout via admin batch" }, 503));

export default app;
