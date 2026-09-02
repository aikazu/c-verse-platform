import { expect, type Page } from "@playwright/test";
import { readDevVar } from "./helpers/db";

/** API lokal (playwright.config webServer) — demo-login + health. */
const API_BASE = "http://127.0.0.1:8787";

/**
 * Mailpit (email UI dari Supabase stack lokal, port 54324) — API v1.
 * Shape dipin dari swagger instance hidup: http://127.0.0.1:54324/api/v1/swagger.json
 * - GET /api/v1/search?query=to:<email> → { messages: [{ ID, ... }] }  (terbaru dulu)
 * - GET /api/v1/message/<ID>           → { ID, Subject, Text, HTML, ... }
 * - DELETE /api/v1/messages            → body { "IDs": [<ID>, ...] }
 */
const MAILPIT_API = "http://127.0.0.1:54324/api/v1";

// Sesi Supabase hidup di localStorage per-origin. redirect_to bawaan email =
// site_url (127.0.0.1:5173) — origin BERBEDA dari baseURL test (localhost:5173)
// sehingga sesi tidak terbaca. `localhost:5173` sudah terdaftar di
// supabase/config.toml `additional_redirect_urls`, jadi rewrite ini valid.
const WEB_ORIGIN = "http://localhost:5173";

interface MailpitMessageSummary {
  ID: string;
}

interface MailpitMessage {
  ID: string;
  Text?: string;
}

/** Cari email berdasarkan alamat penerima via endpoint search Mailpit. */
async function searchMessagesByRecipient(email: string): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { messages?: MailpitMessageSummary[] };
  return body.messages ?? [];
}

/**
 * Ambil magic-link GoTrue dari Mailpit untuk email tertentu (terbaru dulu).
 * GoTrue lokal mengirim MAGIC LINK, bukan kode OTP 6 digit (subject
 * "Your sign-in link", tipe `magiclink`; dibuktikan di run E2E 2026-08-29) —
 * satu-satunya cara menyelesaikan login email di bench lokal. Retry 15×1s.
 */
export async function getMagicLinkFromMailpit(email: string): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const summaries = await searchMessagesByRecipient(email);
      for (const summary of summaries) {
        const res = await fetch(`${MAILPIT_API}/message/${summary.ID}`);
        if (!res.ok) continue;
        const message = (await res.json()) as MailpitMessage;
        const match = (message.Text ?? "").match(/(https?:\/\/[^\s)]+\/auth\/v1\/verify\?[^\s)]+)/);
        if (match) return match[1];
      }
    } catch {
      // Mailpit belum siap / network hiccup — retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Magic link tidak ditemukan untuk ${email} setelah 15 percobaan (Mailpit di ${MAILPIT_API})`);
}

/** Arahkan redirect_to magic link ke origin test (localhost:5173). */
export function toLocalOrigin(magicLink: string): string {
  return magicLink.replace(/redirect_to=[^&\s)]+/, `redirect_to=${encodeURIComponent(WEB_ORIGIN)}`);
}

/**
 * UserMenu hanya dirender setelah auth state resolved — App.tsx:
 * `if (!user) return null`. Ini satu-satunya indikator login yang pasti;
 * teks "Koleksi" dsb. juga muncul di landing tanpa login (false-pass).
 */
export function userMenuLocator(page: Page) {
  return page.locator('button[aria-haspopup="menu"]');
}

/**
 * Login sebagai seed user via magic link GoTrue.
 * 1. Hapus email lama (token single-use tidak boleh tertukar)
 * 2. Kirim email login dari /login
 * 3. Ambil magic link dari Mailpit
 * 4. Kunjungi link (GoTrue verify → redirect ke app dengan sesi di fragment →
 *    supabase-js detectSessionInUrl menyimpan sesi → profil dimuat)
 * 5. Tunggu UserMenu terlihat
 *
 * Fallback demo-login (DEV ONLY): bila tombol kirim OTP disabled, berarti web
 * yang di-REUSE (bukan yang Playwright start) berjalan dengan Turnstile aktif —
 * widget tak pernah issue token tanpa interaksi. Jalur "DEMO — ONE-CLICK LOGIN
 * (LOKAL)" (AuthForm, butuh ENABLE_DEMO_LOGIN=1 di API) tidak butuh captcha.
 */
export async function loginAs(page: Page, email: string): Promise<void> {
  await clearMailbox(email);
  await page.goto("/login");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  await page.fill('input[type="email"]', email);
  const sendButton = page.locator('button:has-text("Kirim")');
  const isSendEnabled = await sendButton.isEnabled({ timeout: 3000 }).catch(() => false);
  if (isSendEnabled) {
    await sendButton.click();

    const magicLink = await getMagicLinkFromMailpit(email);
    await page.goto(toLocalOrigin(magicLink));
  } else if (await tryDemoLoginButton(page, email)) {
    // Tombol DEMO — ONE-CLICK LOGIN tersedia untuk email ini.
  } else {
    await demoLoginViaApi(page, email);
  }

  await expect(userMenuLocator(page)).toBeVisible({ timeout: 15000 });
}

/**
 * True bila tombol kirim OTP bisa diaktifkan di UI (Turnstile menerbitkan token
 * di browser bench). Di bench tanpa token Turnstile (site key terikat domain /
 * widget gagal dimuat), tombol tetap disabled → jalur OTP UI tidak dapat
 * dieksekusi dan spek yang butuh OTP harus skip kondisional.
 */
export async function isOtpPathAvailable(page: Page): Promise<boolean> {
  await page.goto("/login");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', "demo@cverse.id");
  return page
    .locator('button:has-text("Kirim")')
    .isEnabled({ timeout: 4000 })
    .catch(() => false);
}

/** Klik tombol demo-login AuthForm bila tersedia untuk email ini. */
async function tryDemoLoginButton(page: Page, email: string): Promise<boolean> {
  const demoButton = page.getByRole("button", { name: new RegExp(`Masuk sebagai.*${email}`) });
  if ((await demoButton.count()) === 0) return false;
  await demoButton.click();
  return true;
}

/**
 * Demo-login langsung via API (whitelist email seed, auth/routes.ts) lalu
 * simpan sesi ke localStorage browser — REPLIKA persis verifyOtp auth-js:
 * POST /auth/v1/verify {token_hash, type:"magiclink"} (GoTrueClient.js — GET
 * verify tidak menerima token_hash). localStorage key = sb-<host>-auth-token
 * (turunan supabase-js dari VITE_SUPABASE_URL web, tanpa custom storageKey).
 */
async function demoLoginViaApi(page: Page, email: string): Promise<void> {
  const supabaseUrl = (readDevVar("SUPABASE_URL") ?? "http://127.0.0.1:54321").replace(/\/+$/, "");
  const anonKey = readDevVar("SUPABASE_ANON_KEY");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY tidak ada di apps/api/.dev.vars");

  const loginRes = await fetch(`${API_BASE}/api/auth/demo-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!loginRes.ok) throw new Error(`demo-login ${email} ditolak API (HTTP ${loginRes.status}) — butuh ENABLE_DEMO_LOGIN=1 + email seed`);
  const { tokenHash } = (await loginRes.json()) as { tokenHash: string };

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ token_hash: tokenHash, type: "magiclink" }),
  });
  if (!verifyRes.ok) throw new Error(`GoTrue verify untuk ${email} gagal: HTTP ${verifyRes.status}`);
  // Respons verify = objek sesi FLAT (access_token top-level) — xform
  // _sessionResponse auth-js menyimpan objek ini apa adanya ke localStorage.
  const session = (await verifyRes.json()) as { access_token?: string };
  if (!session?.access_token) throw new Error(`GoTrue verify untuk ${email} tidak mengembalikan sesi`);

  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(
    ([key, sessionJson]) => {
      globalThis.localStorage.setItem(key, sessionJson);
    },
    [storageKey, JSON.stringify(session)],
  );
  await page.goto("http://localhost:5173/");
}

/** Hapus email milik alamat tertentu antar test (cleanup best-effort). */
export async function clearMailbox(email: string): Promise<void> {
  try {
    const summaries = await searchMessagesByRecipient(email);
    if (summaries.length === 0) return;
    await fetch(`${MAILPIT_API}/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: summaries.map((summary) => summary.ID) }),
    });
  } catch {
    // cleanup gagal tidak boleh menggagalkan test
  }
}

// ── Admin SPA (apps/admin, port 3000) ────────────────────────────────────────
//
// Alur login admin di bench lokal (diverifikasi di source, 2026-08-29):
// - PROD: email OTP/magic-link + TOTP (aal2) — TotpRequired.tsx.
// - DEV: LoginPage menyediakan tombol demo ("DEMO — Masuk sebagai admin@cverse.id")
//   yang memanggil POST /api/auth/demo-login (butuh ENABLE_DEMO_LOGIN=1 di
//   apps/api/.dev.vars) lalu supabase.auth.verifyOtp({ token_hash }) IN-PAGE —
//   sesi aal1 tersimpan di localStorage origin :3000 tanpa email/redirect.
// - Bypass aal2 hanya di SPA (App.tsx `isDemoDev`); server tetap menegakkan
//   aal2 via requireAdmin (apps/api/src/lib/auth.ts) untuk endpoint
//   requireAdmin — dan TOTP enrollment dinonaktifkan di supabase/config.toml,
//   sehingga aal2 tidak bisa diperoleh di bench lokal.

const ADMIN_ORIGIN = "http://localhost:3000";

/**
 * Login ke admin SPA sebagai admin@cverse.id via tombol demo (DEV-only).
 * Idempotent: bila sesi masih hidup (tombol "Keluar" terlihat), tidak ada aksi.
 * Selesai = Shell dirender, ditandai tombol logout "Keluar" yang hanya ada
 * di dalam Shell (indikator authenticated, analog userMenuLocator di web).
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_ORIGIN}/`);
  const logout = page.getByRole("button", { name: "Keluar" });
  const isAuthenticated = await logout.isVisible().catch(() => false);
  if (isAuthenticated) return;

  const demoButton = page.getByRole("button", { name: /DEMO — Masuk sebagai/ });
  await expect(demoButton).toBeVisible({ timeout: 10000 });
  await demoButton.click();
  await expect(logout).toBeVisible({ timeout: 15000 });
}
