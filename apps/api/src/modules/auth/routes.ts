import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../../lib/auth.js";
import { getSupabase } from "../../lib/supabase.js";

// Auth (docs/10): Supabase Auth (Google OAuth + email OTP) — password register/login/logout
// dan demo-login in-memory dihapus; DB wajib.
//
// POST /demo-login — DEV ONLY (masa demo lokal): one-click login akun seed via
// auth.admin.generateLink (magic link), tetap passwordless & tanpa kirim email.
// Gerbang ganda: flag ENABLE_DEMO_LOGIN (tidak pernah ada di prod) + whitelist
// email seed (supabase/seed.sql) — akun produksi tidak pernah ikut whitelist.

const DEMO_EMAILS: ReadonlySet<string> = new Set([
  "demo@cverse.id",
  "admin@cverse.id",
  "karina@creator.id",
  "hype@creator.id",
  "nova@creator.id",
  "rival@cverse.id",
  "ghost@cverse.id",
  "marked@cverse.id",
]);

const demoLoginSchema = z.object({ email: z.string().email() });

function envFlag(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  return g[name] ?? processEnv?.[name];
}

const app = new Hono();

app.get("/me", async (c) => {
  const result = await requireUser(c);
  if ("error" in result) {
    return c.json({ error: result.error === 403 ? "Akun disuspend" : "Unauthorized" }, result.error);
  }
  const user = result.user;
  return c.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    username: user.username ?? null,
    usernameIsAuto: user.usernameIsAuto ?? false,
    role: user.role,
    xp: user.totalXp,
    totalXp: user.totalXp,
  });
});

app.post("/demo-login", zValidator("json", demoLoginSchema), async (c) => {
  const enabled = ["1", "true"].includes((envFlag("ENABLE_DEMO_LOGIN") ?? "").toLowerCase());
  if (!enabled) return c.json({ error: "Not found" }, 404);

  // Hard-stop produksi (audit 2026-09-04): flag + whitelist saja tidak cukup —
  // satu `wrangler secret put ENABLE_DEMO_LOGIN=1` yang keliru di prod membuka
  // sesi aal1 akun seed (termasuk admin@). ENV=production (default wrangler.toml
  // [vars]) menolak sebelum menyentuh GoTrue.
  const env = (envFlag("ENV") ?? "").toLowerCase();
  if (env === "production") return c.json({ error: "Not found" }, 404);

  const email = c.req.valid("json").email.trim().toLowerCase();
  if (!DEMO_EMAILS.has(email)) return c.json({ error: "Bukan akun demo" }, 403);

  // generateLink TIDAK mengirim email — token_hash-nya ditukar sesi via
  // verifyOtp({ token_hash, type: "magiclink" }) di client.
  const { data, error } = await getSupabase().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) {
    console.error("[demo-login] generateLink gagal:", error?.message);
    return c.json({ error: "Gagal membuat sesi demo" }, 500);
  }
  const tokenHash = data.properties.hashed_token;
  if (!tokenHash) {
    console.error("[demo-login] generateLink tanpa hashed_token");
    return c.json({ error: "Gagal membuat sesi demo" }, 500);
  }
  return c.json({ email, tokenHash });
});

export default app;
