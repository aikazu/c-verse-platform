import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Kontrak API webhook pembayaran (negative path) — tanpa fixture Midtrans.
 * Route: apps/api/src/modules/payments/routes.ts (mounted di /api/payments).
 *
 * - POST /api/payments/midtrans/webhook      — signature Midtrans = sha512(
 *   order_id + status_code + gross_amount + serverKey), diverifikasi LOKAL.
 * - POST /api/payments/midtrans/payout-webhook — header `x-signature-key`
 *   harus sama persis dengan PAYOUT_WEBHOOK_SIGNING_KEY (constant-time compare).
 *
 * Secret TIDAK pernah di-echo: file .dev.vars dibaca read-only hanya sebagai
 * runtime env source (pola parse in-spec), nilainya hanya dipakai menghitung
 * signature di memori. Path positif valid-signature Midtrans tetap di unit test —
 * di sini tidak ada call ke API Midtrans (offline).
 */

const API_BASE = "http://127.0.0.1:8787";

/** Baca satu variabel dari apps/api/.dev.vars (return null jika file/key absen/kosong). */
function readDevVar(key: string): string | null {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), "apps/api/.dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (match && match[1] === key) {
        const value = match[2].trim();
        return value.length > 0 ? value : null;
      }
    }
  } catch {
    // .dev.vars absen (gitignored) — route dianggap not configured
  }
  return null;
}

/** sha512(order_id + status_code + gross_amount + serverKey) — spek notifikasi Midtrans. */
function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

test.describe("Payment webhooks — negative contract", () => {
  test("midtrans top-up webhook: signature invalid/absen ditolak 401 (atau fail-closed 503)", async ({ request }) => {
    const url = `${API_BASE}/api/payments/midtrans/webhook`;
    const serverKey = readDevVar("MIDTRANS_SERVER_KEY");

    if (!serverKey) {
      // Bench ini tanpa MIDTRANS_SERVER_KEY → getProvider() null → route WAJIB
      // fail-closed: menolak memproses apa pun tanpa secret verifikasi (503).
      // Ini kontrak keamanan yang sama pentingnya dengan 401.
      const res = await request.post(url, { data: { order_id: "e2e-x", signature_key: "whatever" } });
      expect(res.status()).toBe(503);
      expect((await res.json()).error).toContain("Not configured");
      return;
    }

    // 1. signature ABSEN → 401, tidak ada kredit.
    const missing = await request.post(url, { data: { order_id: "top-e2e-1", status_code: "200", gross_amount: "100000.00" } });
    expect(missing.status()).toBe(401);
    expect((await missing.json()).error).toContain("Invalid signature");

    // 2. signature SALAH (dihitung dengan server key yang beda) → 401.
    const wrong = await request.post(url, {
      data: {
        order_id: "top-e2e-1",
        status_code: "200",
        gross_amount: "100000.00",
        signature_key: midtransSignature("top-e2e-1", "200", "100000.00", "bukan-server-key"),
      },
    });
    expect(wrong.status()).toBe(401);

    // 3. signature VALID (sha512 lokal dengan server key asli) untuk order_id yang
    // TIDAK cocok format top-{uuid}-ts-rand → route mengabaikan TANPA kredit:
    // {ok:true, ignored:true}. Format sengaja unparseable sehingga route berhenti
    // sebelum provider.getStatus() — deterministic offline.
    const unknown = await request.post(url, {
      data: {
        order_id: "e2e-unknown-order-bukan-format-top",
        status_code: "200",
        gross_amount: "100000.00",
        signature_key: midtransSignature("e2e-unknown-order-bukan-format-top", "200", "100000.00", serverKey),
      },
    });
    expect(unknown.status()).toBe(200);
    const body = (await unknown.json()) as { ok?: boolean; ignored?: boolean };
    expect(body.ok).toBe(true);
    expect(body.ignored).toBe(true);
  });

  test("payout webhook: header x-signature-key invalid/absen ditolak 401 (atau fail-closed 503)", async ({ request }) => {
    const url = `${API_BASE}/api/payments/midtrans/payout-webhook`;
    const signingKey = readDevVar("PAYOUT_WEBHOOK_SIGNING_KEY");

    if (!signingKey) {
      // Tanpa PAYOUT_WEBHOOK_SIGNING_KEY route wajib fail-closed 503 —
      // webhook disbursement tidak boleh memfinalisasi payout tanpa secret.
      const res = await request.post(url, { data: { payout_id: "p-e2e", status: "paid" }, headers: { "x-signature-key": "wrong" } });
      expect(res.status()).toBe(503);
      expect((await res.json()).error).toContain("Not configured");
      return;
    }

    // 1. header ABSEN → 401.
    const missing = await request.post(url, { data: { payout_id: "p-e2e", status: "paid" } });
    expect(missing.status()).toBe(401);
    expect((await missing.json()).error).toContain("Invalid signature");

    // 2. header SALAH → 401 (constant-time compare, length mismatch pun 401).
    const wrong = await request.post(url, { data: { payout_id: "p-e2e", status: "paid" }, headers: { "x-signature-key": "wrong-key" } });
    expect(wrong.status()).toBe(401);

    // 3. signature VALID + payout_id yang tidak ada → 404 "Payout tidak ditemukan"
    // (route.ts: signature lolos → lookup payouts → .single() kosong → 404).
    // Perilaku nyata untuk unknown id: DITOLAK eksplisit, bukan di-ignore.
    const unknown = await request.post(url, {
      data: { payout_id: "payout-e2e-tidak-ada", status: "paid" },
      headers: { "x-signature-key": signingKey },
    });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error).toContain("Payout tidak ditemukan");
  });
});
