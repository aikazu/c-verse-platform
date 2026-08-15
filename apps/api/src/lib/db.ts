import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// RPC facade (docs/13): semua aksi uang & stok lewat Postgres RPC single-transaction.
// RPC security definer membaca auth.uid() dari JWT — klien harus dibuat dengan
// access token USER (diteruskan dari Authorization header), bukan service key.

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

/** Per-request Supabase client authenticated as the calling user (JWT forwarded). */
export function userDb(userToken: string): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  if (!url?.startsWith("http")) {
    throw new Error("SUPABASE_URL tidak terkonfigurasi — API tidak jalan tanpa DB (fail-fast).");
  }
  return createClient(url, userToken, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class RpcError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Silakan login dulu",
  DROP_NOT_LIVE: "Drop belum live / sudah selesai",
  SOLD_OUT: "Unit sudah habis",
  LIMIT_1_PER_DROP: "Kamu sudah memiliki kartu dari drop ini (limit 1 kartu/user/drop)",
  INVALID_POOL: "Pool tidak valid",
  ADDRESS_REQUIRED: "Alamat pengiriman wajib (min 10 karakter) untuk opsi kirim fisik",
  SHIPPING_FEE_REQUIRED: "Ongkir (C-Coin integer ≥ 1) wajib untuk kirim fisik",
  INVALID_AMOUNT: "Nominal tidak valid (integer ≥ 1)",
  INSUFFICIENT: "Saldo C-Coin tidak cukup",
  ENTRY_CLOSED: "Window entry raffle sudah tutup / drop sudah di-draw",
  ENTRY_EXISTS: "Kamu sudah ikut raffle drop ini",
  CARD_NOT_FOUND: "Kartu tidak ditemukan",
  OWN_CARD: "Tidak bisa transaksi kartu sendiri",
  BID_TOO_LOW: "Bid harus lebih tinggi dari active tertinggi",
  NOT_FOUND: "Tidak ditemukan",
  FORBIDDEN: "Tidak diizinkan",
  NOT_ACTIVE: "Bid tidak aktif",
  NO_ACTIVE_BID: "Tidak ada bid active untuk kartu ini",
  MAX_BUYOUT_ACTIVE: "Maksimum 20 kartu buyout aktif per user",
  NOT_FOR_SALE: "Kartu tidak dijual buyout",
  COOLING_PERIOD_14D: "Cooling period 14 hari — tidak bisa membeli kembali kartu yang baru kamu jual",
  CREATOR_SELF_DEALING_30D: "Creator self-dealing dilarang 30 hari — kreator tidak bisa membeli kartu drop sendiri",
};

async function callRpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const code = error.message.trim().split("\n")[0];
    throw new RpcError(code, ERROR_MESSAGES[code] ?? error.message);
  }
  return data as T;
}

export interface CheckoutArgs {
  dropId: string;
  pool: "regular" | "premium";
  delivery: "vault" | "shipping";
  address?: string | null;
  shippingFee?: number | null;
}

export function rpcCheckout(db: SupabaseClient, args: CheckoutArgs) {
  return callRpc<Record<string, unknown>>(db, "checkout", {
    p_drop_id: args.dropId,
    p_pool: args.pool,
    p_delivery: args.delivery,
    p_address: args.address ?? null,
    p_shipping_fee: args.shippingFee ?? null,
  });
}

export function rpcDropEntry(db: SupabaseClient, dropId: string, pool: "regular" | "premium" | "both") {
  return callRpc<Record<string, unknown>>(db, "drop_entry", { p_drop_id: dropId, p_pool: pool });
}

export function rpcPlaceBid(db: SupabaseClient, cardId: string, amountCcoin: number) {
  return callRpc<Record<string, unknown>>(db, "place_bid", { p_card_id: cardId, p_amount: amountCcoin });
}

export function rpcCancelBid(db: SupabaseClient, bidId: string) {
  return callRpc<Record<string, unknown>>(db, "cancel_bid", { p_bid_id: bidId });
}

export function rpcAcceptBid(db: SupabaseClient, cardId: string, destination: "buyer_address" | "platform_vault") {
  return callRpc<Record<string, unknown>>(db, "accept_bid", { p_card_id: cardId, p_destination: destination });
}

export function rpcSetBuyout(db: SupabaseClient, cardId: string, price: number | null) {
  return callRpc<Record<string, unknown>>(db, "set_buyout", { p_card_id: cardId, p_price: price });
}

export function rpcBuyoutCard(db: SupabaseClient, cardId: string) {
  return callRpc<Record<string, unknown>>(db, "buyout_card", { p_card_id: cardId });
}
