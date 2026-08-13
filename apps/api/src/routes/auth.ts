import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { store, ensureSeed, getUserByToken, authHeaderToToken, makeToken, uid, nowIso } from "../lib/store.js";

const app = new Hono();

app.use("*", async (c, next) => { ensureSeed(); await next(); });

app.post("/register", zValidator("json", z.object({
  email: z.string().email(), password: z.string().min(6), displayName: z.string().min(2).max(40),
})), async (c) => {
  const { email, password, displayName } = c.req.valid("json");
  const exists = [...store.users.values()].find(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) return c.json({ error: "Email sudah terdaftar" }, 400);
  const id = uid("u-");
  const username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 16) + "_" + Math.random().toString(36).slice(2, 5);
  store.users.set(id, { id, email, passwordHash: password, displayName, username, role: "user", avatarUrl: null, xp: 0, totalXp: 0, level: 1, cumulativeSpendCcoin: 0, isAnonymous: false, createdAt: nowIso() } as never);
  const { ensureWallet } = await import("../lib/store.js");
  ensureWallet(id);
  const token = makeToken(id);
  return c.json({ token, user: { id, email, displayName, username, role: "user" } });
});

app.post("/login", zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })), async (c) => {
  const { email, password } = c.req.valid("json");
  const user = [...store.users.values()].find(u => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === password);
  if (!user) return c.json({ error: "Email atau password salah" }, 401);
  const token = makeToken(user.id);
  const totalXp = (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0;
  return c.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null, role: user.role, xp: totalXp } });
});

app.post("/demo-login", async (c) => {
  const user = store.users.get("u_demo")!;
  const token = "demo-token";
  store.sessions.set(token, user.id);
  return c.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null, role: user.role } });
});

app.get("/me", async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  const user = getUserByToken(token);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const totalXp = (user as unknown as { totalXp?: number }).totalXp ?? (user as unknown as { xp?: number }).xp ?? 0;
  return c.json({ id: user.id, email: user.email, displayName: user.displayName, username: (user as unknown as { username?: string }).username ?? null, role: user.role, xp: totalXp, totalXp });
});

app.post("/logout", async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  if (token) store.sessions.delete(token);
  return c.json({ ok: true });
});

export default app;
