import { mapCardRow, mapOrderRow, mapShipmentRow, type Row, readDb, seedOnce } from "../reads.js";
import type { Card, Order, Shipment } from "../store.js";
import { store } from "../store.js";

// Domain reads: orders & shipments (docs/13 §3 Wave 3 — public select, no RPC needed).

export async function listOrdersByUser(userId: string): Promise<Order[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.orders.values()].filter((o) => o.userId === userId);
  }
  const { data, error } = await db.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapOrderRow(r as Row));
}

export async function getOrderById(id: string): Promise<Order | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return (store.orders.get(id) as Order | undefined) ?? null;
  }
  const { data, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapOrderRow(data as Row) : null;
}

/** Exact-id card lookup — unlike getCardByIdOrNfc, never falls back to nfc_short_id. */
export async function getCardById(id: string): Promise<Card | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.cards.get(id) ?? null;
  }
  const { data, error } = await db.from("cards").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCardRow(data as Row) : null;
}

export async function listShipmentsByRequester(requesterId: string): Promise<Shipment[]> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.shipments.values()].filter((s) => s.requesterId === requesterId);
  }
  const { data, error } = await db.from("shipments").select("*").eq("requester_id", requesterId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapShipmentRow(r as Row));
}

export async function getShipmentById(id: string): Promise<Shipment | null> {
  const db = readDb();
  if (!db) {
    seedOnce();
    return store.shipments.get(id) ?? null;
  }
  const { data, error } = await db.from("shipments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapShipmentRow(data as Row) : null;
}

export async function listShipmentsByCards(cardIds: string[]): Promise<Shipment[]> {
  if (cardIds.length === 0) return [];
  const db = readDb();
  if (!db) {
    seedOnce();
    return [...store.shipments.values()].filter((s) => cardIds.includes(s.cardId));
  }
  const { data, error } = await db.from("shipments").select("*").in("card_id", cardIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapShipmentRow(r as Row));
}
