import { BID_CANCEL_COOLDOWN_HOURS, MIN_SECONDARY_PRICE_CCOIN } from "@c-verse/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK } from "./errors.js";

// RPC facade (docs/13): semua aksi uang & stok lewat Postgres RPC single-transaction.
// Clients are built with the anon key (valid apikey); the user's JWT is forwarded via
// the accessToken callback (Authorization header) so SECURITY DEFINER RPCs see auth.uid() — never the service key.

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

/** Per-request Supabase client authenticated as the calling user (JWT forwarded). */
export function userDb(userToken: string): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  if (!url?.startsWith("http")) {
    throw new Error("SUPABASE_URL tidak terkonfigurasi — API tidak jalan tanpa DB (fail-fast).");
  }
  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY tidak terkonfigurasi — userDb butuh anon key sebagai apikey (fail-fast).");
  }
  // The client key must be the anon key: hosted Kong validates `apikey` against
  // published keys only and rejects a user JWT there with 401 "Invalid API key"
  // (the local stack is lax, so this only surfaced against the hosted project).
  // The user JWT rides in Authorization via the accessToken callback — SECURITY
  // DEFINER RPCs still resolve auth.uid() from it. A missing anon key must fail
  // fast rather than silently fall back to the user JWT as the client key.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => userToken,
  });
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
  ACCOUNT_SUSPENDED: "Akun disuspend",
  DROP_NOT_LIVE: "Drop belum live / sudah selesai",
  SOLD_OUT: "Unit sudah habis",
  LIMIT_1_PER_DROP: "Kamu sudah memiliki kartu dari drop ini (limit 1 kartu/user/drop)",
  INVALID_POOL: "Pool tidak valid",
  ADDRESS_REQUIRED: "Alamat pengiriman wajib (min 10 karakter) untuk opsi kirim fisik",
  SHIPPING_FEE_REQUIRED: "Ongkir (C-Coin integer ≥ 1) wajib untuk kirim fisik",
  INVALID_AMOUNT: "Nominal tidak valid (integer ≥ 1)",
  SECONDARY_PRICE_TOO_SMALL: `Harga terlalu kecil — minimum ${MIN_SECONDARY_PRICE_CCOIN} C-Coin untuk pasar sekunder`,
  INSUFFICIENT: "Saldo C-Coin tidak cukup",
  ENTRY_CLOSED: "Window entry raffle sudah tutup / drop sudah di-draw",
  ENTRY_EXISTS: "Kamu sudah ikut raffle drop ini",
  CARD_NOT_FOUND: "Kartu tidak ditemukan",
  OWN_CARD: "Tidak bisa transaksi kartu sendiri",
  BID_TOO_LOW: "Bid harus lebih tinggi dari active tertinggi",
  NOT_FOUND: "Tidak ditemukan",
  FORBIDDEN: "Tidak diizinkan",
  NOT_ACTIVE: "Bid tidak aktif",
  // Owner directive 2026-09-01: window cancel mengikuti BID_CANCEL_COOLDOWN_HOURS
  // (packages/shared) — pesan ikut konstanta, bukan angka hardcode.
  BID_CANCEL_COOLDOWN: `Bid baru bisa dibatalkan ${BID_CANCEL_COOLDOWN_HOURS} jam setelah dipasang`,
  NO_ACTIVE_BID: "Tidak ada bid active untuk kartu ini",
  MAX_BUYOUT_ACTIVE: "Maksimum 20 kartu buyout aktif per user",
  NOT_FOR_SALE: "Kartu tidak dijual buyout",
  COOLING_PERIOD_24H: "Blok rebuy 24 jam — tidak bisa membeli kembali kartu yang baru kamu jual",
  CREATOR_SELF_DEALING_30D: "Creator self-dealing dilarang 30 hari — kreator tidak bisa membeli kartu drop sendiri",
  CARD_NOT_TRADABLE: "Kartu berstatus non-tradable (tampered/defect/lost) — tidak bisa ditransaksikan",
  BID_LIMIT: "Maksimum 3 bid aktif — batalkan salah satu bid dulu",
  SELF_SUPPORT: "Tidak bisa mengirim dukungan ke diri sendiri",
  CREATOR_NOT_FOUND: "Kreator tujuan tidak ditemukan",
  KYC_REQUIRED: "KYC harus disetujui dulu sebelum payout",
  MIN_PAYOUT: "Payout minimum 10 C-Gems",
  PAYOUT_HELD: "Payout sedang ditahan admin (fraud hold)",
  TOPUP_CAP_EXCEEDED: "Cap saldo top-up non-KYC tercapai (500 C-Coin) — selesaikan KYC untuk membuka tanpa cap",
  SALE_IN_PROGRESS: "Transaksi sedang berjalan — bid/buyout tidak bisa dipasang sampai transaksi selesai",
  SEED_VAULT_IN_REQUIRED: "Kartu seed wajib masuk vault platform + terverifikasi NFC sebelum release",
  NO_PENDING_SALE: "Tidak ada transaksi seed yang menunggu release untuk kartu ini",
  NOT_SEED_CARD: "Kartu bukan Creator Seed C.Card",
  SEED_ABORT_DUPLICATE: "Transaksi seed ini sudah pernah di-abort sebelumnya",
  CARD_NOT_IN_VAULT: "Kartu harus diterima di vault platform sebelum transaksi atau pengiriman keluar",
  SEED_SALE_IN_PROGRESS: "Kartu seed sedang dalam transaksi yang belum selesai",
  SHIPMENT_ACTIVE: "Sudah ada pengiriman aktif untuk kartu ini",
  INVALID_LEADERBOARD_TYPE: "Tipe leaderboard tidak valid (xp|cards|badges|creator)",
  INVALID_STATE: "Payout tidak bisa di-refund (status disbursed / refunded)",
  INVALID_TRANSITION: "Transisi tidak valid",
  INVALID_ARG: "Argumen tidak valid",
  PERMISSION_DENIED: "Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role",
};

async function callRpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    // Audit 2026-08-31: RAISE EXCEPTION 'CODE: detail' -> err.code adalah token
    // UPPER_SNAKE murni (split di ':' pertama) supaya cabang
    // `err.code === "PERMISSION_DENIED"` dkk. di routes benar-benar match.
    const firstLine = error.message.trim().split("\n")[0] ?? "";
    const colonIdx = firstLine.indexOf(":");
    const code = colonIdx === -1 ? firstLine : firstLine.slice(0, colonIdx).trim();
    const mapped = ERROR_MESSAGES[code];
    if (!mapped) {
      // Unmapped = bukan business code kurasi — raw Postgres/PostgREST text
      // tidak pernah sampai ke klien (generic fallback), raw dilog server-side
      // untuk incident response (pola yang sama dengan app.onError).
      console.error(`[db.rpc:${fn}] unmapped error (${error.code ?? "-"}):`, error.message);
    }
    throw new RpcError(mapped ? code : "RPC_FAILED", mapped ?? FALLBACK);
  }
  return data as T;
}

// Founder 2026-08-28: checkout settle langsung ke vault, tanpa alamat/ongkir
// di titik beli (shipping = flow pasca-vault). Pool = unit regular/premium;
// guard INVALID_POOL di sisi SQL.
export function rpcCheckout(db: SupabaseClient, dropId: string, pool: "regular" | "premium" = "regular") {
  return callRpc<Record<string, unknown>>(db, "checkout", { p_drop_id: dropId, p_pool: pool });
}

// Post-purchase ship-out dari platform vault (owner bayar ship fee).
// Atomic di SQL: shipment insert + fee debit ke treasury + platform_revenue
// (ref_type 'shipment') dalam satu transaksi. Fee BUKAN parameter — SQL
// derive dari konstanta server SHIPMENT_FEE_CCOIN (audit 2026-08-31).
export function rpcVaultShipout(db: SupabaseClient, cardId: string, address: string) {
  return callRpc<Record<string, unknown>>(db, "vault_shipout", {
    p_card_id: cardId,
    p_address: address,
  });
}

export function rpcSellerToVault(db: SupabaseClient, cardId: string, address: string, tracking: string | null) {
  return callRpc<Record<string, unknown>>(db, "seller_to_vault", {
    p_card_id: cardId,
    p_address: address,
    p_tracking: tracking,
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

export function rpcAcceptBid(
  db: SupabaseClient,
  cardId: string,
  destination: "buyer_address" | "platform_vault",
  address: string | null = null,
) {
  return callRpc<Record<string, unknown>>(db, "accept_bid", { p_card_id: cardId, p_destination: destination, p_address: address });
}

export function rpcSetBuyout(db: SupabaseClient, cardId: string, price: number | null) {
  return callRpc<Record<string, unknown>>(db, "set_buyout", { p_card_id: cardId, p_price: price });
}

export function rpcBuyoutCard(
  db: SupabaseClient,
  cardId: string,
  destination: "buyer_address" | "platform_vault" = "platform_vault",
  address: string | null = null,
) {
  return callRpc<Record<string, unknown>>(db, "buyout_card", { p_card_id: cardId, p_destination: destination, p_address: address });
}

// Support (A1 2026-08-31): fan dukungan C-Coin 100% ke kreator (tanpa potongan
// platform). Atomic di SQL: debit pengirim + kredit kreator; pengirim dapat
// XP 1:1 (aturan spend). Returns { transactionId, balanceCcoin }.
export function rpcSendSupport(db: SupabaseClient, creatorId: string, amountCcoin: number) {
  return callRpc<{ transactionId: string; balanceCcoin: number }>(db, "send_support", {
    p_creator: creatorId,
    p_amount: amountCcoin,
  });
}

// PHASE-2 settlement seed (service_role HANYA — dipanggil admin via API).
export function rpcReleaseSeedSale(db: SupabaseClient, cardId: string) {
  return callRpc<Record<string, unknown>>(db, "release_seed_sale", { p_card_id: cardId });
}

// PHASE-1 admin abort path (service_role HANYA) — refund buyer untuk stuck
// seed sales (kartu hilang / tidak pernah di-vault). Returns json
// {cardId, refundedCcoin, buyerId, path, alreadyAborted?}.
export function rpcCancelSeedSale(db: SupabaseClient, cardId: string) {
  return callRpc<Record<string, unknown>>(db, "cancel_seed_sale", { p_card_id: cardId });
}

// Admin refund path (docs/14 §3.3): return locked payout funds to creator when
// disbursement will not / did not happen. service_role only.
export function rpcPayoutRefund(db: SupabaseClient, payoutId: string) {
  return callRpc<Record<string, unknown>>(db, "payout_refund", { p_payout_id: payoutId });
}

// Admin shipment fulfillment (audit refactor 2026-08-23): moves the
// sequential shipments/orders/cards writes from PATCH /api/shipments/:id/status
// into a single SECURITY DEFINER RPC. service_role only.
export function rpcAdminFulfillShipment(db: SupabaseClient, shipmentId: string, status: string, tracking: string | null) {
  return callRpc<Record<string, unknown>>(db, "admin_fulfill_shipment", {
    p_id: shipmentId,
    p_status: status,
    p_tracking: tracking,
  });
}
