import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runCron } from "./lib/cron.js";
import admin from "./routes/admin.js";
import auth from "./routes/auth.js";
import bids from "./routes/bids.js";
import browse from "./routes/browse.js";
import creators from "./routes/creators.js";
import drops from "./routes/drops.js";
import gamification from "./routes/gamification.js";
import kyc from "./routes/kyc.js";
import marketplace from "./routes/marketplace.js";
import nfc from "./routes/nfc.js";
import orders from "./routes/orders.js";
import payments from "./routes/payments.js";
import profile from "./routes/profile.js";
import publicProfile from "./routes/publicProfile.js";
import seo from "./routes/seo.js";
import shipments from "./routes/shipments.js";
import wallet from "./routes/wallet.js";

export type Bindings = {
  ENV?: string;
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
      if (!origin) return "https://c-verse.co";
      if (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("pages.dev")) return origin;
      if (origin === "https://c-verse.co" || origin === "https://www.c-verse.co") return origin;
      if (origin === "https://api.c-verse.co" || origin.endsWith(".c-verse.co")) return origin;
      if (origin === "https://c-verse.id" || origin === "https://www.c-verse.id") return origin;
      return origin;
    },
    allowHeaders: ["Content-Type", "Authorization", "x-forwarded-for"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/", (c) => c.json({ name: "C.Verse API", version: "0.1.0", tagline: "Revolusi Ekonomi Kreator", status: "ok" }));
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
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
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
