import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Frame, type Locator, type Page, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

/**
 * REAL top-up e2e — loop penuh Midtrans SNAP sandbox (satu-satunya spec yang
 * menyentuh payment gateway sungguhan + butuh internet).
 *
 * Flow: login demo → /wallet → submit form "Isi Saldo" (10 C) → modal konfirmasi
 * in-app (D8) → redirect penuh ke Snap sandbox → bayar kartu uji → Midtrans
 * POST webhook (SHA512) ke API → wallet_credit idempotent → saldo +10 dan baris
 * ledger "Top-up +10 C" muncul di /wallet (dipoll, karena kredit datang dari
 * webhook, bukan redirect — Wallet.tsx L44).
 *
 * ── KONTRAK AKTIVASI (dilakukan owner; spec SKIP kalau tidak lengkap) ──────
 * 1. Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/
 *    connections/connect-networks/downloads/) lalu expose API lokal:
 *      cloudflared tunnel --url http://localhost:8787
 *    → catat URL publiknya, mis. https://<random>.trycloudflare.com
 *    (webhook Midtrans butuh URL PUBLIK — localhost tidak pernah menerima POST.)
 * 2. Di Midtrans dashboard SANDBOX (dashboard.sandbox.midtrans.com) → Settings →
 *    Configuration → Payment Notification URL, daftarkan:
 *      https://<tunnel>/api/payments/midtrans/webhook
 *    (tanpa ini pembayaran sukses tidak pernah mengkredit saldo).
 * 3. Jalankan spec dengan env tunnel:
 *      E2E_TUNNEL_BASE_URL=https://<tunnel>.trycloudflare.com \
 *        pnpm exec playwright test 12-topup-snap
 *
 * SKIP otomatis (dengan alasan eksplisit) bila: binary `cloudflared` tidak ada
 * di PATH, `E2E_TUNNEL_BASE_URL` tidak diset, `MIDTRANS_SERVER_KEY` tidak ada
 * di apps/api/.dev.vars, saldo demo menyisakan headroom < 10 C di bawah cap
 * non-KYC 500, atau tunnel tidak reachable saat test jalan.
 *
 * Kredensial kartu di bawah adalah TEST VALUES sandbox Midtrans yang dipublikasi
 * resmi di docs Midtrans (bukan secret asli): simulator kartu selalu approve,
 * 3DS OTP sandbox selalu 112233.
 */

const API_HEALTH_TIMEOUT_MS = 10_000;
const NON_KYC_CAP_CCOIN = 500; // BALANCE_CAP_CCOIN (packages/shared) — literal agar e2e tidak dep ke workspace
const TOPUP_AMOUNT_CCOIN = 10;
const WEBHOOK_LATENCY_TIMEOUT_MS = 45_000;

const SANDBOX_CARD_NUMBER = "4811111111111114";
const SANDBOX_CARD_EXPIRY = "1230"; // MMYY bebas (masa depan) — simulator sandbox selalu approve
const SANDBOX_CARD_CVV = "123";
const SANDBOX_3DS_OTP = "112233";

/** Baca satu variabel dari apps/api/.dev.vars (null jika file/key absen/kosong). Nilai TIDAK pernah di-echo. */
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
    // .dev.vars absen (gitignored) — provider Midtrans dianggap tidak terkonfigurasi
  }
  return null;
}

/** True bila tunnel meneruskan ke API lokal — dicek runtime di dalam test (murah & akurat). */

const TUNNEL_BASE_URL = (process.env.E2E_TUNNEL_BASE_URL ?? "").trim().replace(/\/+$/, "");

const missingPrerequisites: string[] = [];
if (TUNNEL_BASE_URL.length === 0) {
  missingPrerequisites.push(
    "env E2E_TUNNEL_BASE_URL belum diset — set ke URL publik tunnel, mis. E2E_TUNNEL_BASE_URL=https://<random>.trycloudflare.com",
  );
}
if (readDevVar("MIDTRANS_SERVER_KEY") === null) {
  missingPrerequisites.push("MIDTRANS_SERVER_KEY belum ada di apps/api/.dev.vars — tanpa itu POST /api/payments/topup selalu 503");
}

test.skip(
  missingPrerequisites.length > 0,
  `Prasyarat real-Snap e2e belum lengkap: ${missingPrerequisites.join("; ")}. Ikuti kontrak aktivasi di header file ini.`,
);

/** Snap redirect penuh: app.sandbox.midtrans.com/snap/v2/vtweb/... embed pay.*.midtrans.com di iframe. */
async function resolveSnapFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const frames = page.frames();
    const payFrame = frames.find((f) => /pay\.(sandbox\.)?midtrans\.com/.test(f.url()));
    if (payFrame) return payFrame;
    const appFrame = frames.find((f) => /midtrans\.com\/snap/.test(f.url()));
    if (appFrame) return appFrame;
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Frame Snap tidak ditemukan dalam 20s (frames: ${page
      .frames()
      .map((f) => f.url())
      .join(" | ")})`,
  );
}

/** Klik kandidat locator pertama yang visible (Snap UI berubah-ubah label EN/ID). */
async function clickFirstVisible(candidates: Locator[], label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const target = candidate.first();
      try {
        if (!(await target.isVisible())) continue;
        await target.click({ timeout: 5_000 });
        return;
      } catch {
        // kandidat re-render/detach — lanjut kandidat berikutnya
      }
    }
    await candidates[0]?.page().waitForTimeout(500);
  }
  throw new Error(`Elemen Snap tidak ditemukan: ${label}`);
}

/** Isi form kartu di Snap sandbox (kartu uji resmi Midtrans). */
async function fillSandboxCardForm(snap: Frame): Promise<void> {
  const cardNumber = snap
    .locator('input[name*="card" i], input[placeholder*="4811"], input[aria-label*="card" i], input[aria-label*="Kartu" i]')
    .first();
  await cardNumber.waitFor({ state: "visible", timeout: 20_000 });
  await cardNumber.fill(SANDBOX_CARD_NUMBER);
  const expiry = snap
    .locator('input[name*="expir" i], input[placeholder*="MM"], input[aria-label*="expir" i], input[aria-label*="thru" i]')
    .first();
  await expiry.fill(SANDBOX_CARD_EXPIRY);
  const cvv = snap.locator('input[name*="cvv" i], input[placeholder*="CVV" i], input[aria-label*="cvv" i]').first();
  await cvv.fill(SANDBOX_CARD_CVV);
}

/** 3DS simulator muncul sebagai iframe (bisa nested) — isi OTP sandbox lalu submit. */
async function complete3dsOtp(page: Page): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const otpInput = frame.locator('input[type="password"]').first();
      if (!(await otpInput.isVisible().catch(() => false))) continue;
      await otpInput.fill(SANDBOX_3DS_OTP);
      await clickFirstVisible(
        [
          frame.getByRole("button", { name: /^(ok|submit|bayar|kirim)$/i }),
          frame.locator("button[type=submit]"),
          frame.locator("input[type=submit]"),
        ],
        "tombol submit OTP 3DS",
        10_000,
      );
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Halaman 3DS (input OTP) tidak muncul dalam 30s — pastikan kartu uji 4811... dipakai");
}

/** Tunggu halaman sukses Snap (tanpa callbacks.finish, Snap menampilkan success page sendiri). */
async function waitForSnapSuccess(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const success = frame.getByText(/berhasil|successful|terima kasih|thank you/i).first();
      if (await success.isVisible().catch(() => false)) return;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error("Halaman sukses Snap tidak muncul dalam 60s");
}

/** Saldo terisi di kartu "Saldo" /wallet (tunggu LoadingState selesai dulu). */
async function readBalance(page: Page): Promise<number> {
  const value = page.locator(".wa-balance-value").first();
  await value.waitFor({ state: "visible", timeout: 15_000 });
  return Number.parseInt((await value.innerText()).replace(/[^\d]/g, ""), 10);
}

/** Probe murah: tunnel masih hidup dan meneruskan ke API lokal? */
async function isTunnelReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${TUNNEL_BASE_URL}/health`, { signal: AbortSignal.timeout(API_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

test.describe("Wallet top-up — real Midtrans Snap (sandbox)", () => {
  // Email lama di Mailpit membuat getMagicLinkFromMailpit mengambil link stale → login gagal.
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });
  test("top-up 10 C via Snap sandbox → webhook mengkredit saldo + ledger row", async ({ page }) => {
    test.setTimeout(240_000); // flow lintas gateway + latensi webhook > timeout global 30s

    if (!(await isTunnelReachable())) {
      test.skip(
        true,
        `Tunnel ${TUNNEL_BASE_URL} tidak reachable dari mesin ini — jalankan \`cloudflared tunnel --url http://localhost:8787\` dulu, lalu set E2E_TUNNEL_BASE_URL ke URL publiknya`,
      );
    }

    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");

    const balanceBefore = await readBalance(page);
    // Cap non-KYC 500 C: kalau seed demo sudah mentok, spec skip (bukan fail) —
    // webhook juga akan menolak kredit (TOPUP_CAP_EXCEEDED).
    const amountSelect = page.locator('select[aria-label="Jumlah top-up C-Coin"]');
    const isKycApproved = (await amountSelect.locator('option[value="1000"]').count()) > 0;
    if (!isKycApproved && balanceBefore + TOPUP_AMOUNT_CCOIN > NON_KYC_CAP_CCOIN) {
      test.skip(
        true,
        `Saldo demo ${balanceBefore} C menyisakan headroom < ${TOPUP_AMOUNT_CCOIN} C di bawah cap non-KYC ${NON_KYC_CAP_CCOIN} — jalankan \`npx supabase db reset\` untuk seed ulang`,
      );
    }

    await amountSelect.selectOption(String(TOPUP_AMOUNT_CCOIN));
    await page.locator("button.wa-btn-block").click();
    // Uang asli wajib modal konfirmasi in-app (D8) — jendela native confirm dilarang.
    const topupDialog = page.getByRole("dialog");
    const payButton = topupDialog.getByRole("button", { name: "Bayar" });
    await expect(payButton).toBeDisabled();
    await topupDialog.getByRole("checkbox").check();
    await payButton.click();

    // createTopup mengembalikan redirect_url → window.location.href (Wallet.tsx L63).
    await page.waitForURL(/midtrans\.com\/snap/, { timeout: 30_000 });

    const snap = await resolveSnapFrame(page);
    await clickFirstVisible(
      [snap.getByRole("button", { name: /kartu|card/i }), snap.getByText(/kartu kredit|credit\/debit|credit card/i)],
      "pilihan metode bayar Kartu di Snap",
    );

    await fillSandboxCardForm(snap);
    await clickFirstVisible(
      [snap.getByRole("button", { name: /^(pay|bayar)$/i }), snap.locator("button[type=submit]")],
      "tombol Pay di form kartu Snap",
    );

    await complete3dsOtp(page);
    await waitForSnapSuccess(page);

    // Kredit datang dari WEBHOOK (asinkron) — poll /wallet sampai saldo naik tepat +10 C.
    const expectedBalance = balanceBefore + TOPUP_AMOUNT_CCOIN;
    await expect
      .poll(
        async () => {
          await page.goto("/wallet");
          return readBalance(page);
        },
        { timeout: WEBHOOK_LATENCY_TIMEOUT_MS, intervals: [3_000] },
      )
      .toBe(expectedBalance);

    // Baris ledger: tipe "Top-up" + amount +10 C (pill label dari walletTxTypeLabel).
    const ledgerRow = page
      .locator("table tbody tr")
      .filter({ hasText: `+${TOPUP_AMOUNT_CCOIN} C` })
      .filter({ hasText: "Top-up" });
    await expect(ledgerRow.first()).toBeVisible();
  });
});
