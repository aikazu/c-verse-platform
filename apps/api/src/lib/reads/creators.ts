import { mapCreatorRow, mapUserRow, type Row, readDb, seedOnce } from "../reads.js";
import type { CreatorPageView, CreatorRec, User } from "../store.js";
import { nowIso, store, uid } from "../store.js";

// Domain reads: creators + creator page-view analytics (docs 05 creator_page_views, docs 09 3.5).

const nstr = (v: unknown): string | null => (v == null ? null : String(v));

function mapPageViewRow(r: Row): CreatorPageView {
  return {
    id: String(r.id ?? ""),
    creatorId: String(r.creator_id ?? ""),
    viewedAt: String(r.viewed_at ?? ""),
    referrer: nstr(r.referrer),
    city: nstr(r.city),
    userId: nstr(r.user_id),
  };
}

export async function listCreators(): Promise<CreatorRec[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.creators.values()];
  }
  const { data, error } = await db.from("creators").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCreatorRow(r as Row));
}

export async function getCreatorByHandle(handle: string): Promise<CreatorRec | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.creators.values()].find((cr) => cr.handle.toLowerCase() === handle.toLowerCase()) ?? null;
  }
  const { data, error } = await db.from("creators").select("*").ilike("handle", handle).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCreatorRow(data as Row) : null;
}

export async function getCreatorByUserId(userId: string): Promise<CreatorRec | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.creators.values()].find((cr) => cr.userId === userId) ?? null;
  }
  const { data, error } = await db.from("creators").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCreatorRow(data as Row) : null;
}

/** Users carrying role=creator (creator listing/SEO derive from users, creators table only adds handle/followers). */
export async function listCreatorUsers(): Promise<User[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.users.values()].filter((u) => (u.role as string) === "creator");
  }
  const { data, error } = await db.from("users").select("*").eq("role", "creator").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapUserRow(r as Row));
}

export async function listCreatorPageViews(creatorId: string): Promise<CreatorPageView[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.creatorPageViews.filter((v) => v.creatorId === creatorId);
  }
  const { data, error } = await db.from("creator_page_views").select("*").eq("creator_id", creatorId).order("viewed_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapPageViewRow(r as Row));
}

export interface CreatorPageViewInput {
  creatorId: string;
  referrer: string | null;
  city: string | null;
  userId: string | null;
}

/** Fire-and-forget analytics write (INSERT only — not part of money/stock RPC surface). */
export function recordCreatorPageView(input: CreatorPageViewInput): void {
  const db = readDb();
  if (!db) {
    seedOnce();
    store.creatorPageViews.push({ id: uid("cpv-"), ...input, viewedAt: nowIso() });
    // guard Y1 <10k/day — simple cap 50k in-memory (avoid unbounded growth)
    if (store.creatorPageViews.length > 50000) store.creatorPageViews.splice(0, 10000);
    return;
  }
  // id is plain text without DB default — generate client-side; viewed_at defaults to now()
  const id = `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // PostgrestFilterBuilder is PromiseLike (not a full Promise) — wrap to attach .catch
  void Promise.resolve(
    db
      .from("creator_page_views")
      .insert({ id, creator_id: input.creatorId, referrer: input.referrer, city: input.city, user_id: input.userId }),
  ).catch((err: unknown) => console.error("[creator_page_views] insert failed:", err));
}
