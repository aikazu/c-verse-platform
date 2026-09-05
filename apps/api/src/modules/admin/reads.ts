import { userDb } from "../../lib/db.js";
import { readDb } from "../../lib/reads.js";

type CountResult = { count: number | null; error: unknown };

async function countOrNull(query: PromiseLike<CountResult>): Promise<number | null> {
  try {
    const result = await query;
    return result.error ? null : (result.count ?? 0);
  } catch {
    return null;
  }
}

function rowsOrThrow<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function getAdminDashboard() {
  const db = readDb();
  const [drops, orders, creators, shipmentsActionable, kycPending, disputesOpen, payoutsPending] = await Promise.all([
    countOrNull(db.from("drops").select("id", { count: "exact", head: true })),
    countOrNull(db.from("orders").select("id", { count: "exact", head: true })),
    countOrNull(db.from("creators").select("id", { count: "exact", head: true })),
    countOrNull(db.from("shipments").select("id", { count: "exact", head: true }).in("status", ["requested", "packed"])),
    countOrNull(db.from("kyc_records").select("id", { count: "exact", head: true }).eq("status", "pending")),
    countOrNull(db.from("disputes").select("id", { count: "exact", head: true }).in("status", ["open", "under_review"])),
    countOrNull(db.from("payouts").select("id", { count: "exact", head: true }).in("status", ["pending", "processing", "failed"])),
  ]);

  return {
    stats: { drops, orders, creators },
    counts: { shipmentsActionable, kycPending, disputesOpen, payoutsPending },
  };
}

export async function getAdminDrops() {
  const db = readDb();
  const [drops, activeCreators] = await Promise.all([
    db
      .from("drops")
      .select(
        "id,title,series,status,total_units,sold_count,price_ccoin,price_unsigned_ccoin,artwork_url,raffle_end_at,drawn_at,created_at,is_seed",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("creators")
      .select("user_id,handle,users!inner(display_name,role,flag_reason)")
      .eq("status", "active")
      .eq("users.role", "creator")
      .is("users.flag_reason", null)
      .not("user_id", "is", null)
      .order("handle", { ascending: true }),
  ]);
  return { drops: rowsOrThrow(drops), activeCreators: rowsOrThrow(activeCreators) };
}

export async function getAdminCreators() {
  const db = readDb();
  const [creators, users, wallets] = await Promise.all([
    db
      .from("creators")
      .select("id,user_id,handle,total_followers_combined,status,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("users").select("id,email,display_name,username,role,flag_reason").order("created_at", { ascending: false }).limit(500),
    db.from("wallets").select("user_id,hold_payout_until").limit(1000),
  ]);
  return { creators: rowsOrThrow(creators), users: rowsOrThrow(users), wallets: rowsOrThrow(wallets) };
}

export async function getAdminOrders() {
  const db = readDb();
  const [orders, shipments] = await Promise.all([
    db.from("orders").select("id,card_id,status,delivery_option,created_at").order("created_at", { ascending: false }).limit(100),
    db
      .from("shipments")
      .select("id,card_id,requester_id,type,from_location,to_dest,address,status,tracking_number")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  return { orders: rowsOrThrow(orders), shipments: rowsOrThrow(shipments) };
}

export async function getAdminPayouts() {
  const db = readDb();
  const [batches, payouts] = await Promise.all([
    db.from("payout_batches").select("id,batch_code,status,total_ccoin,total_idr").order("created_at", { ascending: false }).limit(500),
    db.from("payouts").select("id,user_id,type,ccoin_amount,idr_amount,status,batch_id").order("batch_id", { ascending: false }).limit(500),
  ]);
  return { batches: rowsOrThrow(batches), payouts: rowsOrThrow(payouts) };
}

export async function getAdminNfc() {
  const db = readDb();
  const [batches, cards, seedPending] = await Promise.all([
    db.from("nfc_batches").select("id,batch_code,qty,status").order("created_at", { ascending: false }),
    db.from("cards").select("id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status").limit(50),
    db
      .from("cards")
      .select("id,nfc_uid,nfc_short_id,verify_status,status,location,drop_id,drops!inner(is_seed)")
      .eq("status", "bid_pending")
      .eq("drops.is_seed", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  return { batches: rowsOrThrow(batches), cards: rowsOrThrow(cards), seedPending: rowsOrThrow(seedPending) };
}

export async function getAdminInvestor(adminToken: string) {
  const [stats, drops] = await Promise.all([
    userDb(adminToken).rpc("get_investor_stats"),
    readDb().from("drops").select("id,title,status,total_units,sold_count").order("created_at", { ascending: false }).limit(100),
  ]);
  if (stats.error) throw stats.error;
  return { stats: stats.data ?? null, drops: rowsOrThrow(drops) };
}
