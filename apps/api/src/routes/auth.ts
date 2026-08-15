import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";

// Auth (docs/10): Supabase Auth (Google OAuth + email OTP) — password register/login/logout
// dan demo-login in-memory dihapus; DB wajib.

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

export default app;
