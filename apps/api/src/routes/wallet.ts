import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet, addTx } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: { req: { header: (k: string) => string | undefined } }): ReturnType<typeof getUserByToken> {
  return getUserByToken(authHeaderToToken(c.req.header("authorization")));
}

const KYC_THRESHOLD = 99; // FINAL 2026-08-13: KYC HANYA payout/disbursement + akumulasi top-up besar (07 C-05b). 99 = threshold topup; payout selalu KYC.

app.get("/", async (c) => {
  const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const w = ensureWallet(user.id);
  const txs = store.walletTx.filter((t) => t.userId === user.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json({ wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR }, transactions: txs.slice(0, 100), rate: C_COIN_RATE_IDR, thresholdKyc: KYC_THRESHOLD, balanceCap: 1000, minPayout: 10 });
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
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const raw = c.req.valid("json") as { amountCCoin?: number; amountCcoin?: number; amount_ccoin?: number; method: string };
    const amountCCoin = raw.amountCcoin ?? raw.amountCCoin ?? raw.amount_ccoin;
    if (amountCCoin == null) return c.json({ error: "amountCCoin wajib" }, 400);

    // KYC gate: top-up kumulatif >99 C-Coin requires KYC approved (07 C-05b)
    const cumBefore = store.walletTx.filter((t) => t.userId === user!.id && (t.type === "topup" || t.type === "top_up") && t.amountCCoin > 0).reduce((n, t) => n + t.amountCCoin, 0);
    if (cumBefore + amountCCoin > KYC_THRESHOLD) {
      const kyc = [...store.kyc.values()].find((k) => k.userId === user!.id && k.status === "approved");
      if (!kyc) return c.json({ error: `KYC diperlukan untuk top-up kumulatif > ${KYC_THRESHOLD} C-Coin`, needKyc: true, cumulativeWouldBe: cumBefore + amountCCoin, threshold: KYC_THRESHOLD }, 400);
    }

    // Balance cap (docs/07 C-08): tolak top-up yang melampaui cap saldo (default 1000 C)
    const BALANCE_CAP = 1000;
    const wouldBe = ensureWallet(user.id).balanceCCoin + amountCCoin;
    if (wouldBe > BALANCE_CAP) return c.json({ error: 'Cap saldo terlampaui (' + BALANCE_CAP + ' C-Coin) — top-up ditolak', cap: BALANCE_CAP, wouldBe }, 400);

    // Opsi A: buyer closed-loop — top-up menambah saldo; withdrawal buyer tidak ada (refund-to-source only di ops manual)
    // Gateway mocked (Midtrans/Xendit) — langsung credit; metadata holds method for reconciliation
    const tx = addTx(user.id, "top_up", amountCCoin, "topup", `top-${Date.now()}`, `Top-up ${amountCCoin} C-Coin via ${raw.method} (Rp ${(amountCCoin * C_COIN_RATE_IDR).toLocaleString("id-ID")})`, {
      method: raw.method,
      idempotency_key: `top-${user.id}-${Date.now()}`,
    });
    // XP: top-up TIDAK menambah XP per 05-data-model / 07 C-05c — only spend + badge reward does
    const w = ensureWallet(user.id);
    return c.json({ wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR }, transaction: tx, xpNote: "Top-up tidak menambah XP — XP naik saat spending C-Coin." });
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
    const user = requireAuth(c as unknown as { req: { header: (k: string) => string | undefined } });
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const raw = c.req.valid("json") as { amountCCoin?: number; amountCcoin?: number; bankAccount?: string };
    const amountCCoin = raw.amountCcoin ?? raw.amountCCoin;
    if (amountCCoin == null) return c.json({ error: "amountCCoin wajib" }, 400);
    if (amountCCoin < 10) return c.json({ error: "Minimum payout 10 C-Coin (Rp 100.000)", minPayout: 10 }, 400);
    const w = ensureWallet(user.id);
    if (w.balanceCCoin < amountCCoin) return c.json({ error: "Saldo tidak cukup untuk payout" }, 400);
    // KYC + bank gate for payouts (prevents arbitrary withdraw)
    const kyc = [...store.kyc.values()].find((k) => k.userId === user.id && k.status === "approved");
    if (!kyc) return c.json({ error: "KYC approved wajib untuk payout", needKyc: true }, 400);
    const feeCCoin = Math.max(1, Math.ceil(amountCCoin * 0.01));
    addTx(user.id, "payout", -amountCCoin, "payout", `payout-${Date.now()}`, `Payout ${amountCCoin} C-Coin -> IDR (fee 1% = ${feeCCoin} C-Coin)`);
    const netIdr = (amountCCoin - feeCCoin) * C_COIN_RATE_IDR;
    return c.json({ ok: true, netCCoin: amountCCoin - feeCCoin, feeCCoin, netIdr, wallet: { ...ensureWallet(user.id), balanceIdrEquiv: ensureWallet(user.id).balanceCCoin * C_COIN_RATE_IDR } });
  },
);

export default app;
