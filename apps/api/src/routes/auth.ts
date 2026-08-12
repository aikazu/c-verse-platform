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
  store.users.set(id, { id, email, passwordHash: password, displayName, role: "collector", avatarUrl: null, xp: 0, createdAt: nowIso() });
  // wallet init
  const { ensureWallet } = await import("../lib/store.js");
  ensureWallet(id);
  const token = makeToken(id);
  return c.json({ token, user: { id, email, displayName, role: "collector" } });
});

app.post("/login", zValidator("json", z.object({ email: z.string().email(), password: z.string().min(1) })), async (c) => {
  const { email, password } = c.req.valid("json");
  const user = [...store.users.values()].find(u => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === password);
  if (!user) return c.json({ error: "Email atau password salah" }, 401);
  const token = makeToken(user.id);
  return c.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
});

app.post("/demo-login", async (c) => {
  const user = store.users.get("u_demo")!;
  const token = "demo-token";
  store.sessions.set(token, user.id);
  return c.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
});

app.get("/me", async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  const user = getUserByToken(token);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, xp: user.xp });
});

app.post("/logout", async (c) => {
  const token = authHeaderToToken(c.req.header("authorization"));
  if (token) store.sessions.delete(token);
  return c.json({ ok: true });
});

export default app;
