import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { sanitizeDbError } from "../lib/errors.js";
import { listNotificationsByUser, markNotificationRead } from "../lib/reads/notifications.js";
import { readDb } from "../lib/reads.js";

const app = new Hono();

// GET / — inbox untuk user saat ini (channel='in_app' & status='sent').
// Filter ini mengikuti semantic "delivered" sehingga user tidak melihat pending
// queue item (yang dipakai worker untuk push/email). pending items disembunyikan
// sampai status flip ke 'sent' oleh trigger SQL.
app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const list = await listNotificationsByUser(user.id, limit);
  return c.json({ notifications: list });
});

// GET /unread-count — badge number di menu (bell icon).
app.get("/unread-count", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const db = readDb();
  // status='sent' AND read_at IS NULL. Pakai head+count untuk hemat bandwidth.
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("channel", "in_app")
    .eq("status", "sent")
    .is("read_at", null);
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  return c.json({ unread: count ?? 0 });
});

// PATCH /:id/read — tandai satu notifikasi sudah dibaca.
app.patch("/:id/read", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const ok = await markNotificationRead(c.req.param("id"), user.id);
  if (!ok) return c.json({ error: "Notifikasi tidak ditemukan" }, 404);
  return c.json({ ok: true });
});

// PATCH /read-all — tandai semua notif user sudah dibaca.
app.patch("/read-all", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const user = authRes.user;
  const db = readDb();
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("channel", "in_app")
    .eq("status", "sent")
    .is("read_at", null);
  if (error) return c.json({ error: sanitizeDbError(error) }, 400);
  return c.json({ ok: true });
});

export default app;
