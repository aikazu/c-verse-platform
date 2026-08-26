import { readDb } from "../reads.js";

export interface NotificationRow {
  id: string;
  userId: string;
  channel: "email" | "push" | "in_app";
  templateKey: string;
  payload: Record<string, unknown> | null;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  readAt: string | null;
}

/**
 * P0-3 (audit 2026-08-24): inbox user — channel='in_app' & status='sent',
 * sorted by createdAt desc. Pending disembunyikan sampai trigger SQL flip.
 */
export async function listNotificationsByUser(userId: string, limit: number): Promise<NotificationRow[]> {
  const db = readDb();
  const { data, error } = await db
    .from("notifications")
    .select("id,user_id,channel,template_key,payload,status,created_at,read_at")
    .eq("user_id", userId)
    .eq("channel", "in_app")
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    channel: String(r.channel) as NotificationRow["channel"],
    templateKey: String(r.template_key),
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    status: String(r.status) as NotificationRow["status"],
    createdAt: String(r.created_at),
    readAt: r.read_at ? String(r.read_at) : null,
  }));
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
  const db = readDb();
  const { data, error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}
