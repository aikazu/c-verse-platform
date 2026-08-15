import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { ensureSeed, makeToken, store } from "../lib/store.js";
import { isSupabaseEnabled } from "../lib/supabase.js";

// Auth (docs/10): Supabase Auth (Google OAuth + email OTP) — password register/login/logout dihapus.
// Demo-login hanya tersisa untuk mode dev tanpa Supabase (founder demo, VITE_ENABLE_DEMO_LOGIN).

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
    role: user.role,
    xp: user.totalXp,
    totalXp: user.totalXp,
  });
});

// Dev-only demo session (1 klik) — dinonaktifkan permanen saat Supabase terhubung.
app.post("/demo-login", async (c) => {
  ensureSeed();
  if (isSupabaseEnabled()) {
    return c.json({ error: "Demo login dinonaktifkan — gunakan login Google / email OTP" }, 403);
  }
  const user = store.users.get("u_demo");
  if (!user) return c.json({ error: "Demo user tidak tersedia" }, 404);
  const token = makeToken(user.id);
  return c.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName, username: user.username ?? null, role: user.role },
  });
});

export default app;
