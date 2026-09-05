import { type Context, Hono, type Next } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { clientIp, tokenFingerprint } from "./lib/auth.js";
import { runCron } from "./lib/cron.js";
import type { EmailBindings } from "./lib/email.js";
import { clientErrorMessage } from "./lib/errors.js";
import { type PublicAssetBindings, serveLocalPublicAsset } from "./lib/publicAssets.js";
import admin from "./modules/admin/index.js";
import auth from "./modules/auth/index.js";
import bids from "./modules/bids/index.js";
import creators from "./modules/creators/index.js";
import drops from "./modules/drops/index.js";
import gamification from "./modules/gamification/index.js";
import kyc, { type KycBindings } from "./modules/kyc/index.js";
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

export type Bindings = EmailBindings &
  KycBindings &
  PublicAssetBindings & {
    ENV?: string;
    ADMIN_ALERT_EMAIL?: string; // cron failure digest recipient (lib/cron.ts)
    AUTH_RATE_LIMITER?: RateLimit;
    GLOBAL_RATE_LIMITER?: RateLimit;
    KYC_RATE_LIMITER?: RateLimit;
    NFC_RATE_LIMITER?: RateLimit;
    UPLOAD_RATE_LIMITER?: RateLimit;
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
      return isDev || isProd ? origin : fallback;
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
  // Audit 2026-09-04 M-7: HSTS (tanpa preload dulu) — menutup downgrade HTTP
  // bila edge Cloudflare tidak menyetelnya. API hanya dilayani via HTTPS.
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // L6 (audit 2026-08-24): Content-Security-Policy. The API returns JSON or XML
  // (sitemap); nothing here needs to load scripts, so deny by default. The SPA
  // (apps/web) carries its own CSP meta tag via the SEO Worker; this is the
  // defense-in-depth layer in case the SPA is ever served through this origin.
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
});

// ── Rate Limiter (I-01) ──
// Always register middleware. Request bindings, not import-time Node environment
// or executable paths, determine whether this invocation is production.
type LimiterName = "AUTH_RATE_LIMITER" | "GLOBAL_RATE_LIMITER" | "KYC_RATE_LIMITER" | "NFC_RATE_LIMITER" | "UPLOAD_RATE_LIMITER";
const limitWith = (name: LimiterName, message: string) => async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  // `app.request()` unit tests and Node-local execution do not inject Worker
  // bindings. Production is fail-closed because Wrangler always supplies
  // ENV=production together with every configured limiter binding.
  if (c.env?.ENV !== "production") {
    await next();
    return;
  }
  const limiter = c.env[name];
  if (!limiter) return c.json({ error: "Rate limiter belum terkonfigurasi" }, 503);
  // Prefer a non-reversible user-session fingerprint; IP is only the fallback
  // for unauthenticated endpoints such as login and NFC verification.
  const actor = (await tokenFingerprint(c.req.header("authorization"))) ?? clientIp(c) ?? "anonymous";
  const { success } = await limiter.limit({ key: actor });
  if (!success) return c.json({ error: message }, 429);
  await next();
};

app.use("/api/auth/*", limitWith("AUTH_RATE_LIMITER", "Too many requests — coba lagi nanti"));
app.use("/api/payments/*", limitWith("AUTH_RATE_LIMITER", "Too many requests — coba lagi nanti"));
app.use("/api/kyc", limitWith("KYC_RATE_LIMITER", "Terlalu banyak pengajuan KYC — coba lagi nanti"));
app.use("/api/nfc/*", limitWith("NFC_RATE_LIMITER", "Terlalu banyak percobaan verifikasi — coba lagi nanti"));
app.use("/api/profile/avatar", limitWith("UPLOAD_RATE_LIMITER", "Terlalu banyak upload gambar — coba lagi nanti"));
app.use("/api/drops/:id/artwork", limitWith("UPLOAD_RATE_LIMITER", "Terlalu banyak upload gambar — coba lagi nanti"));
app.use("*", limitWith("GLOBAL_RATE_LIMITER", "Too many requests — coba lagi nanti"));
app.get("/", (c) => c.json({ name: "C.Verse API", tagline: "Revolusi Ekonomi Kreator", status: "ok" }));
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/assets/*", async (c) => {
  const response = await serveLocalPublicAsset(c.req.raw, c.env as PublicAssetBindings);
  return response ?? c.json({ error: "Not found" }, 404);
});

app.route("/api/auth", auth);
app.route("/api/drops", drops);
app.route("/api/wallet", wallet);
app.route("/api/orders", orders);
app.route("/api/nfc", nfc);
app.route("/api/marketplace", marketplace);
app.route("/api/bids", bids);
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
