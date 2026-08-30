import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { rateLimiter } from "hono-rate-limiter";
import { clientIp } from "./lib/auth.js";
import { runCron } from "./lib/cron.js";
import type { EmailBindings } from "./lib/email.js";
import { clientErrorMessage } from "./lib/errors.js";
import admin from "./modules/admin/index.js";
import auth from "./modules/auth/index.js";
import bids from "./modules/bids/index.js";
import browse from "./modules/browse/index.js";
import creators from "./modules/creators/index.js";
import drops from "./modules/drops/index.js";
import gamification from "./modules/gamification/index.js";
import kyc from "./modules/kyc/index.js";
import marketplace from "./modules/marketplace/index.js";
import nfc from "./modules/nfc/index.js";
import notifications from "./modules/notifications/index.js";
import orders from "./modules/orders/index.js";
import payments from "./modules/payments/index.js";
import profile from "./modules/profile/index.js";
import publicProfile from "./modules/publicProfile/index.js";
import seo from "./modules/seo/index.js";
import shipments from "./modules/shipments/index.js";
import wallet from "./modules/wallet/index.js";

export type Bindings = EmailBindings & {
  ENV?: string;
  ADMIN_ALERT_EMAIL?: string; // cron failure digest recipient (lib/cron.ts)
};

// Fail-fast (F-08 diperketat): tanpa SUPABASE_URL API menolak start — tidak ada
// lagi mode in-memory. Jalankan `npx supabase start` lalu set apps/api/.dev.vars.
const g = globalThis as unknown as Record<string, string | undefined>;
const supabaseUrl = g.SUPABASE_URL ?? (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
if (!supabaseUrl?.startsWith("http")) {
  throw new Error("SUPABASE_URL wajib — API tidak jalan tanpa Supabase DB (npx supabase start + apps/api/.dev.vars).");
}

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      const fallback = "https://c-verse.co";
      if (!origin) return fallback;
      let host: string;
      try {
        host = new URL(origin).hostname;
      } catch {
        return fallback;
      }
      // Parse hostname (not substring) to avoid bypass like https://localhost.evil.com.
      const isDev = host === "localhost" || host === "127.0.0.1";
      const isProd = host === "c-verse.co" || host === "c-verse.id" || host.endsWith(".c-verse.co") || host.endsWith(".c-verse.id");
      const isPreview = host.endsWith(".pages.dev");
      return isDev || isProd || isPreview ? origin : fallback;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// ── Security Headers (M-02) ──
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // L6 (audit 2026-08-24): Content-Security-Policy. The API returns JSON or XML
  // (sitemap); nothing here needs to load scripts, so deny by default. The SPA
  // (apps/web) carries its own CSP meta tag via the SEO Worker; this is the
  // defense-in-depth layer in case the SPA is ever served through this origin.
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
});

// ── Rate Limiter (I-01) ──
// Hanya aktif di production/staging — development skip biar gak ganggu dev workflow
// Deteksi dev: process.argv via tsx, ENV=development, atau SUPABASE_URL localhost
const isTsxDev = typeof process !== "undefined" && (process.argv?.[1]?.includes("tsx") ?? false);
const envMode = typeof process !== "undefined" ? process.env.ENV : undefined;
const supabaseIsLocal = (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined)?.includes("localhost") ?? false;
const isProduction = !isTsxDev && envMode !== "development" && !supabaseIsLocal;

if (isProduction) {
  // Behind Cloudflare: trust CF-Connecting-IP first; x-forwarded-for is client-spoofable so it is last resort.
  // Single source of truth (lib/auth.ts -> clientIp) keeps audit-log and rate-limiter in lockstep.
  const clientKey = (c: { req: { header: (k: string) => string | undefined } }) => clientIp(c) ?? "loopback";

  const authLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-6",
    keyGenerator: clientKey,
    message: { error: "Too many requests — coba lagi nanti" },
  });

  // NFC verify is unauthenticated + does crypto/DB writes — throttle tighter than global.
  const nfcLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-6",
    keyGenerator: clientKey,
    message: { error: "Terlalu banyak percobaan verifikasi — coba lagi nanti" },
  });

  const globalLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-6",
    keyGenerator: clientKey,
    message: { error: "Too many requests — coba lagi nanti" },
  });

  app.use("/api/auth/*", authLimiter);
  app.use("/api/payments/*", authLimiter);
  app.use("/api/nfc/*", nfcLimiter);
  app.use("*", globalLimiter);
}

app.get("/", (c) => c.json({ name: "C.Verse API", tagline: "Revolusi Ekonomi Kreator", status: "ok" }));
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route("/api/auth", auth);
app.route("/api/drops", drops);
app.route("/api/wallet", wallet);
app.route("/api/orders", orders);
app.route("/api/nfc", nfc);
app.route("/api/marketplace", marketplace);
app.route("/api/bids", bids);
app.route("/api/browse", browse);
app.route("/api/profile", profile);
app.route("/api/public", publicProfile);
app.route("/api/gamification", gamification);
app.route("/api/creators", creators);
app.route("/api/kyc", kyc);
app.route("/api/notifications", notifications);
app.route("/api/shipments", shipments);
app.route("/api/seo", seo);
app.route("/api/payments", payments);
app.route("/api/admin", admin);
app.get("/sitemap.xml", async (c) => {
  // delegate to seo handler so both /sitemap.xml and /api/seo/sitemap.xml work (SEO Worker fetches either)
  const r = await seo.fetch(new Request(new URL("/sitemap.xml", c.req.url).toString()), c.env as never, c.executionCtx as never);
  return r;
});

// Compat alias: old clients hit /api/listings directly (buyout-only since C-07 FINAL)
app.route("/api/listings", marketplace);

// Fallback JSON 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));
app.onError((err, c) => {
  // Raw error tetap dilog server-side untuk incident response — jangan pernah echo.
  console.error(err);
  // M-03 + pentest P2 (2026-08-30): pesan untuk klien lewat satu seam allowlist —
  // HTML upstream diblok, pesan teknis dipetakan/fallback, hanya curated RPC
  // business codes (UPPER_SNAKE token) yang lolos verbatim.
  return c.json({ error: clientErrorMessage(err) }, 500);
});

// Cron Triggers (docs/08 §3.3) — escrow/draw tiap 5 menit, payout batch Selasa 06:00 WIB.
type ScheduledControllerLike = { cron: string; scheduledTime: number };
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledControllerLike, env: Bindings, ctx: ExecutionContextLike) {
    ctx.waitUntil(runCron(controller.cron, (env ?? {}) as Record<string, string | undefined>));
  },
};

// Test hook: export Hono instance untuk route test (Vitest)
export { app };
