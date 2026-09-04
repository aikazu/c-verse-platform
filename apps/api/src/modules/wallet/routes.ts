import { BALANCE_CAP_CCOIN, C_COIN_RATE_IDR, MIN_PAYOUT_CCOIN, supportSchema } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../lib/auth.js";
import { RpcError, rpcSendSupport, userDb } from "../../lib/db.js";
import { sanitizeDbError } from "../../lib/errors.js";
import { getWallet, isPayoutHeld, listGemTxs, listWalletTxs } from "./reads.js";

const app = new Hono();

app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const w = await getWallet(user.id);
  const txs = await listWalletTxs(user.id, 100);
  const gemTxs = await listGemTxs(user.id, 100);
  const held = await isPayoutHeld(user.id);
  return c.json({
    wallet: { ...w, balanceIdrEquiv: w.balanceCCoin * C_COIN_RATE_IDR },
    transactions: txs,
    gemTxs,
    rate: C_COIN_RATE_IDR,
    topupCapNoKyc: BALANCE_CAP_CCOIN, // non-KYC cap 500; KYC approved = tanpa cap
    minPayout: MIN_PAYOUT_CCOIN,
    payoutHeld: held.held,
    payoutHoldUntil: held.until,
    disclosureOpsiA:
      "C-Coin adalah saldo belanja closed-loop dan tidak dapat diuangkan. Hasil penjualan seller/kreator masuk sebagai C-Gems yang dapat di-payout ke IDR (fee 1%, minimum 10 C-Gems, KYC wajib).",
  });
});

// Real-money path (docs/14): top-up via Midtrans (/api/payments/topup + webhook) — uang
// masuk HANYA lewat webhook terverifikasi signature. Stub ini menolak dengan arahan jelas.
app.post("/topup", zValidator("json", z.object({}).passthrough()), async (_c) =>
  _c.json({ error: "Top-up via Midtrans: POST /api/payments/topup" }, 503),
);

// Payout: creator minta disbursement via /api/payments/payout (request) — batch mingguan admin.
app.post("/payout", zValidator("json", z.object({}).passthrough()), async (_c) =>
  _c.json({ error: "Payout request via POST /api/payments/payout" }, 503),
);

// Support (A1): fan dukungan C-Coin 100% ke kreator — tanpa potongan platform.
// Atomic di SQL via RPC send_support (debit pengirim + kredit kreator); pengirim
// dapat XP 1:1 (aturan spend), kreator tidak. Target wajib kreator aktif.
app.post("/support", zValidator("json", supportSchema), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { creatorId, amountCcoin } = c.req.valid("json");
  try {
    const result = await rpcSendSupport(userDb(authRes.token), creatorId, amountCcoin);
    return c.json({ transactionId: result.transactionId, balanceCcoin: result.balanceCcoin });
  } catch (err) {
    if (err instanceof RpcError) {
      const status = err.code === "AUTH_REQUIRED" ? 401 : err.code === "INSUFFICIENT" ? 402 : err.code === "CREATOR_NOT_FOUND" ? 404 : 400;
      return c.json({ error: err.message, code: err.code }, status);
    }
    return c.json({ error: sanitizeDbError(err instanceof Error ? err : { message: String(err) }) }, 500);
  }
});

// Convert (dual-token docs/07): Gems -> C-Coin 1:1 via RPC convert_gems (atomic
// di SQL). Response = wallet terbaru (balanceGems + breakdown matured) supaya
// UI tidak perlu re-fetch setelah konversi.
app.post("/convert", zValidator("json", z.object({ amountGems: z.number().int().min(1) })), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { amountGems } = c.req.valid("json");
  const db = userDb(authRes.token);
  const { error } = await db.rpc("convert_gems", { p_amount: amountGems });
  if (error) {
    const code = error.message.trim().split("\n")[0];
    const status = code === "AUTH_REQUIRED" ? 401 : 400;
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Silakan login dulu",
      INSUFFICIENT_GEMS: "Gems tidak cukup",
    };
    return c.json({ error: messages[code] ?? sanitizeDbError(error), code }, status);
  }
  const wallet = await getWallet(authRes.user.id);
  return c.json({ wallet });
});

export default app;
