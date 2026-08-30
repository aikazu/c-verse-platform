import { mapCardRow, mapDropRow, readDb } from "../reads.js";
import type { Card, Drop } from "../store.js";

// Domain reads: drops & cards (docs/13 Wave 1 — public select, no RPC needed).

export interface DropFilter {
  status?: string;
  search?: string;
  viewerId?: string;
  viewerRole?: string;
  publicStatuses?: string[];
}

export async function listDrops(filter?: DropFilter): Promise<Drop[]> {
  const db = readDb();
  let query = db.from("drops").select("*").order("created_at", { ascending: false }).limit(2000);

  // Status filter — langsung di SQL, hindari in-memory filter
  if (filter?.status && filter.status !== "all") {
    query = query.eq("status", filter.status);
  }

  // Viewer-aware: non-admin cuma lihat public + owned drafts
  if (!filter) {
    // no filter — no-op, query stays as-is
  } else if (filter.viewerRole === "admin") {
    // admin lihat semua — tanpa filter status tambahan
  } else if (filter.viewerId) {
    const publicStatuses = filter.publicStatuses ?? ["live", "published", "sold_out", "closed", "scheduled"];
    query = query.or(`creator_id.eq.${filter.viewerId},status.in.(${publicStatuses.join(",")})`);
  } else {
    const publicStatuses = filter.publicStatuses ?? ["live", "published", "sold_out", "closed", "scheduled"];
    query = query.in("status", publicStatuses);
  }

  // Search di SQL via ilike
  if (filter?.search) {
    query = query.or(`title.ilike.%${filter.search}%,series.ilike.%${filter.search}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapDropRow(r as Record<string, unknown>));
}

export async function getDropById(id: string): Promise<Drop | null> {
  const db = readDb();
  const { data, error } = await db.from("drops").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDropRow(data as Record<string, unknown>) : null;
}

export async function listCardsByDrop(dropId: string): Promise<Card[]> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").eq("drop_id", dropId).order("unit_number");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

/** Batch fetch by ids — 1 query untuk N kartu (hindari N+1 di order detail). */
export async function listCardsByIds(ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

export interface CardQuery {
  ownerId?: string;
  dropId?: string;
}

export async function listCards(query: CardQuery = {}): Promise<Card[]> {
  const db = readDb();
  let sel = db.from("cards").select("*");
  if (query.ownerId != null) sel = sel.eq("owner_id", query.ownerId);
  if (query.dropId != null) sel = sel.eq("drop_id", query.dropId);
  const { data, error } = await sel.order("unit_number");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapCardRow(r as Record<string, unknown>));
}

/** Resolve card by id OR nfcShortId (route params accept both). */
export async function getCardByIdOrNfc(idOrShort: string): Promise<Card | null> {
  const db = readDb();
  const { data, error } = await db.from("cards").select("*").or(`id.eq.${idOrShort},nfc_short_id.eq.${idOrShort}`).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Record<string, unknown>) : null;
}
