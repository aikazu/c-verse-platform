import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, ensureWallet, addTx, nowIso } from "../lib/store.js";
import { C_COIN_RATE_IDR } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

function requireAuth(c: any) {
  const token = authHeaderToToken(c.req.header("authorization"));
  const user = getUserByToken(token);
  return user;
}

app.get("/", async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const w = ensureWallet(user.id);
  const txs = store.walletTx.filter(t => t.userId === user.id).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return c.json({ wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR }, transactions: txs.slice(0, 50), rate: C_COIN_RATE_IDR });
});

app.post("/topup", zValidator("json", z.object({
  amountCCoin: z.number().int().min(1).max(10000),
  method: z.enum(["qris","va_bca","va_mandiri","ewallet_gopay","ewallet_ovo"]).default("qris"),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { amountCCoin, method } = c.req.valid("json");
  // Simulate gateway success (Midtrans/Xendit) — langsung top-up
  const tx = addTx(user.id, "topup", amountCCoin, "topup", `top-${Date.now()}`, `Top-up ${amountCCoin} C-Coin via ${method} (Rp ${(amountCCoin*C_COIN_RATE_IDR).toLocaleString("id-ID")})`);
  const w = ensureWallet(user.id);
  // XP reward
  user.xp += Math.floor(amountCCoin * 0.5);
  return c.json({ wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR }, transaction: tx });
});

app.post("/payout", zValidator("json", z.object({
  amountCCoin: z.number().int().min(1),
  bankAccount: z.string().min(5).max(50).optional(),
})), async (c) => {
  const user = requireAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { amountCCoin } = c.req.valid("json");
  const w = ensureWallet(user.id);
  if (w.balanceCCoin < amountCCoin) return c.json({ error: "Saldo tidak cukup" }, 400);
  const feeCCoin = Math.max(1, Math.ceil(amountCCoin * 0.01));
  // For MVP, payout is only for seller/creator disbursement simulation — deduct full, fee recorded
  addTx(user.id, "payout", -amountCCoin, "payout", `payout-${Date.now()}`, `Payout ${amountCCoin} C-Coin -> IDR (fee 1% = ${feeCCoin} C-Coin)`);
  // fee is informational; net received = amount - fee
  const netIdr = (amountCCoin - feeCCoin) * C_COIN_RATE_IDR;
  return c.json({ ok: true, netCCoin: amountCCoin - feeCCoin, feeCCoin, netIdr, wallet: { ...ensureWallet(user.id), balanceIdrEquiv: ensureWallet(user.id).balanceCCoin * C_COIN_RATE_IDR } });
});

export default app;
