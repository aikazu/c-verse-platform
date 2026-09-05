import { z } from "zod";

// =============================================================================
// C.Verse Platform — Shared constants & schemas  (canonical, single source)
// Sources: docs/00-README glossary, docs/01-scope, docs/05-data-model,
//          docs/07-constraints, docs/NUMBERS-equivalent
// =============================================================================

// ── Money: C-Coin ────────────────────────────────────────────────────────────
export const C_COIN_RATE_IDR = 10_000; // 1 C-Coin = Rp 10.000 (FINAL)
export const AOV_UNSIGNED_IDR = 300_000;
export const AOV_SIGNED_IDR = 500_000;
export const AOV_UNSIGNED_CCOIN = AOV_UNSIGNED_IDR / C_COIN_RATE_IDR; // 30
export const AOV_SIGNED_CCOIN = AOV_SIGNED_IDR / C_COIN_RATE_IDR; // 50

// integer >= 1, no decimals — all C-Coin nominals ceil from IDR
export function idrToCCoin(idr: number): number {
  if (!Number.isFinite(idr) || idr <= 0) return Number.NaN; // guard: nominal wajib > 0 (Lane D 2026-08-31: 0 ditolak)
  return Math.ceil(idr / C_COIN_RATE_IDR);
}
export function ccoinToIdr(ccoin: number): number {
  return ccoin * C_COIN_RATE_IDR;
}
export function formatCCoin(ccoin: number): string {
  return `${ccoin} C-Coin`;
}
export function formatIdr(idr: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(idr);
}

// ── Fees & revenue share ───────────────────────────────────────────────────
export const PAYOUT_FEE_PCT = 0.01; // 1% disbursement fee to seller/creator
// Vault ship-out ongkir — server-side constant, bukan input client (audit
// 2026-08-31: fee client-supplied underchargable to 1 C). Docs pin no fixed
// value ("ongkir C-Coin integer >= 1"); 2 = nilai default UI sebelumnya.
export const SHIPMENT_FEE_CCOIN = 2;
export const SECONDARY_FEE_PCT = 0.15; // 15% total secondary
export const SECONDARY_PLATFORM_PCT = 0.075;
export const SECONDARY_ROYALTY_PCT = 0.075;
export const SECONDARY_SELLER_PCT = 0.85;
// Floor harga jual sekunder: price - 2*ceil(0.075p) >= 1 hanya terpenuhi di
// p >= 3 — di bawahnya seller share <= 0 dan settlement akan abort
// (SECONDARY_PRICE_TOO_SMALL di RPC accept_bid/buyout_card/release_seed_sale).
export const MIN_SECONDARY_PRICE_CCOIN = 3;
export const REVENUE_SHARE_PLATFORM_PRODUCED = { platform: 0.7, creator: 0.3 } as const;
export const REVENUE_SHARE_CREATOR_PRODUCED = { platform: 0.3, creator: 0.7 } as const; // deferred Y2+ (not in MVP)

/**
 * Secondary sale fee split (15% total: 7.5 platform + 7.5 royalty + 85 seller).
 * Integer C-Coin: platform/royalty CEILED (Lane D 2026-08-31 — round-to-nearest
 * lama membuat harga kecil terbelah 0/0/price: pendapatan platform menguap,
 * melanggar aturan "platform revenue must never evaporate"). Seller takes the
 * remainder so the three parts always sum exactly to the sale price.
 * Catatan: price <= 2 menghasilkan seller <= 0 — ditolak di sisi schema
 * (MIN_SECONDARY_PRICE_CCOIN) dan guard RPC SECONDARY_PRICE_TOO_SMALL.
 */
export function splitSecondaryFeeCcoin(priceCcoin: number): { platformCcoin: number; royaltyCcoin: number; sellerCcoin: number } {
  const platformCcoin = Math.ceil(priceCcoin * SECONDARY_PLATFORM_PCT);
  const royaltyCcoin = Math.ceil(priceCcoin * SECONDARY_ROYALTY_PCT);
  return { platformCcoin, royaltyCcoin, sellerCcoin: priceCcoin - platformCcoin - royaltyCcoin };
}

// ── Domain & product shape ─────────────────────────────────────────────────
export const PRIMARY_DOMAIN = "c-verse.co"; // 00-README: must lock before NFC provisioning
export const SECONDARY_DOMAIN = "c-verse.id";
export const CREATOR_THRESHOLD_FOLLOWERS = 100_000; // combined — off-platform validated

// Public image uploads (avatar + drop artwork). The readonly tuple is also the
// browser accept-list; byte limits remain server-enforced canonical values.
export const PUBLIC_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PublicImageType = (typeof PUBLIC_IMAGE_TYPES)[number];
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;

// ── Enums (align docs/05-data-model) ──────────────────────────────────────
export const userRoleSchema = z.enum(["user", "creator", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const dropStatusSchema = z.enum(["draft", "scheduled", "published", "live", "sold_out", "closed", "cancelled"]);
export type DropStatus = z.infer<typeof dropStatusSchema>;

export const orderStatusSchema = z.enum(["paid", "qc", "shipped", "delivered", "settled", "refunded", "disputed"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const deliveryOptionSchema = z.enum(["shipping", "vault"]);
export type DeliveryOption = z.infer<typeof deliveryOptionSchema>;

export const escrowStatusSchema = z.enum(["held", "released"]);
export type EscrowStatus = z.infer<typeof escrowStatusSchema>;

export const cardLocationSchema = z.enum(["platform_stock", "with_owner", "platform_vault"]);
export type CardLocation = z.infer<typeof cardLocationSchema>;

export const cardStatusSchema = z.enum(["inventory", "bound", "listed_buyout", "bid_pending", "sold", "tampered", "defect", "lost"]);
export type CardStatus = z.infer<typeof cardStatusSchema>;

export const shipmentTypeSchema = z.enum([
  "primary_shipping",
  "primary_vault",
  "secondary_buyout",
  "secondary_bid",
  "vault_shipout",
  // P0-6 (audit 2026-08-24): seller mengirim kartu miliknya (location='with_owner')
  // ke platform vault untuk verifikasi sebelum payout release.
  "secondary_seller_to_vault",
]);
export type ShipmentType = z.infer<typeof shipmentTypeSchema>;

export const shipmentToDestSchema = z.enum(["buyer_address", "platform_vault"]);
export type ShipmentToDest = z.infer<typeof shipmentToDestSchema>;

export const shipmentStatusSchema = z.enum(["requested", "packed", "shipped", "delivered", "cancelled"]);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

export const walletTxTypeSchema = z.enum([
  "top_up",
  "checkout",
  "escrow_hold",
  "escrow_release",
  "settlement",
  "payout",
  "payout_refund",
  "royalty",
  "refund",
  "adjustment",
  "platform_buy",
  "platform_revenue",
  "seed_abort",
  "vault_shipout",
  "support",
  "convert",
]);
export type WalletTxType = z.infer<typeof walletTxTypeSchema>;

export const verifyStatusSchema = z.enum(["verified", "tamper_detected", "registered", "unknown"]);
// docs/03 flow 4: server maps QR-without-CMAC to "registered" (weaker label)
export type VerifyStatus = z.infer<typeof verifyStatusSchema>;

export const bidStatusSchema = z.enum(["active", "outbid", "cancelled", "accepted"]);
export type BidStatus = z.infer<typeof bidStatusSchema>;

export const kycStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type KycStatus = z.infer<typeof kycStatusSchema>;

export const levelTierSchema = z.enum(["orbit", "meteor", "komet", "planet", "nebula", "nova", "supernova", "pulsar", "kuasar", "galaksi"]);
export type LevelTier = z.infer<typeof levelTierSchema>;

// Secondary market = buyout on card + direct bids (C-07 FINAL — no auction/listing).

// ── API Schemas ────────────────────────────────────────────────────────────
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const createDropSchema = z.object({
  title: z.string().min(3).max(120),
  series: z.string().min(3).max(120),
  narrative: z.string().min(10).max(5000),
  artworkUrl: z.string().url().optional().or(z.literal("")),
  artwork3dUrl: z.string().url().optional().or(z.literal("")),
  totalUnits: z.number().int().min(1).max(1000),
  priceCCoin: z.number().int().min(1).default(AOV_UNSIGNED_CCOIN), // single price (MVP platform-produced)
  // backwards compat: unsigned/signed split still accepted by API but mapped to priceCCoin
  priceUnsignedCCoin: z.number().int().min(1).optional(),
  priceSignedCCoin: z.number().int().min(1).optional(),
  dropStartAt: z.iso.datetime().optional(),
  dropEndAt: z.iso.datetime().optional(),
  creatorId: z.string().optional(),
});
export type CreateDropInput = z.infer<typeof createDropSchema>;

// Checkout: single-card, 1 kartu/user/drop. Founder 2026-08-28: semua pembelian
// settle LANGSUNG ke vault — tanpa alamat/ongkir di titik beli. Shipping adalah
// flow pasca-vault via POST /api/orders/vault-shipout. Pool = pilihan unit
// (regular/premium); guard INVALID_POOL di sisi RPC.
export const checkoutSchema = z.object({
  dropId: z.string().min(1),
  pool: z.enum(["regular", "premium"]).default("regular"),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Secondary: set buyout price on owned card (KYC gate before). Floor harga:
// MIN_SECONDARY_PRICE_CCOIN — di bawahnya seller share <= 0 (settlement abort).
export const setBuyoutSchema = z.object({
  cardId: z.string().min(1),
  buyoutPriceCcoin: z.number().int().min(MIN_SECONDARY_PRICE_CCOIN).nullable(), // null = cabut buyout
});
export type SetBuyoutInput = z.infer<typeof setBuyoutSchema>;

// Bids: directly on card (no listing indirection). 1 active per card; outbid auto-release.
// Floor amount = MIN_SECONDARY_PRICE_CCOIN — settlement split ceil butuh seller >= 1.
export const placeBidSchema = z.object({
  cardId: z.string().min(1),
  amountCcoin: z.number().int().min(MIN_SECONDARY_PRICE_CCOIN),
  // legacy alias
  amountCCoin: z.number().int().min(MIN_SECONDARY_PRICE_CCOIN).optional(),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

// Accept bid: founder 2026-08-28 — SEMUA pembelian settle ke vault tanpa
// alamat. Body kosong (strict): destination/address/fee bukan lagi input user;
// shipping pasca-vault via POST /api/orders/vault-shipout.
export const acceptBidSchema = z.object({}).strict();
export type AcceptBidInput = z.infer<typeof acceptBidSchema>;

export const cancelBidSchema = z.object({
  bidId: z.string().min(1),
});

// Fee TIDAK bagian body — ongkir ship-out adalah konstanta server
// SHIPMENT_FEE_CCOIN (di-derive di dalam RPC vault_shipout).
export const vaultShipoutSchema = z.object({
  cardId: z.string().min(1),
  address: z.string().min(10).max(500),
});
export type VaultShipoutInput = z.infer<typeof vaultShipoutSchema>;

export const topupSchema = z.object({
  amountCCoin: z.number().int().min(1).max(10000),
  amountCcoin: z.number().int().min(1).max(10000).optional(), // alias
  method: z.enum(["qris", "va_bca", "va_mandiri", "ewallet_gopay", "ewallet_ovo"]).default("qris"),
});

// Support (A1): fan dukungan C-Coin ke kreator — 100% tanpa potongan platform;
// pengirim dapat XP 1:1 (aturan spend). Target wajib kreator (divalidasi RPC).
export const supportSchema = z
  .object({
    creatorId: z.string().uuid(),
    amountCcoin: z.number().int().min(1),
  })
  .strict();
export type SupportInput = z.infer<typeof supportSchema>;

export const verifyNfcSchema = z.object({
  uid: z.string().min(1),
  counter: z.string().optional(),
  cmac: z.string().optional(),
  shortId: z.string().optional(),
});

export const kycSchema = z.object({
  fullName: z.string().min(2).max(100),
  nik: z.string().length(16),
  dob: z.string().optional(),
  address: z.string().min(10).max(500),
});

export const privacySchema = z.object({
  isAnonymous: z.boolean(),
});

// Leaderboard types: xp (max level), cards (most valid owned cards),
// badges (most badges), creator (collector board for one creator).
// Tie-break on equal score: earlier `reachedAt` ranks higher, then username ASC
// (enforced server-side; shape is defined here so route + UI agree on contract).
export const leaderboardTypeSchema = z.enum(["xp", "cards", "badges", "creator"]);
export type LeaderboardType = z.infer<typeof leaderboardTypeSchema>;

export const leaderboardQuerySchema = z
  .object({
    type: leaderboardTypeSchema.default("xp"),
    // creatorId REQUIRED when type==="creator"; FORBIDDEN otherwise
    // (cross-field rule — global boards don't accept a creator filter).
    creatorId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(5).max(50).default(20),
  })
  .superRefine((value, ctx) => {
    if (value.type === "creator" && value.creatorId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creatorId"],
        message: "creatorId is required when type is 'creator'",
      });
    }
    if (value.type !== "creator" && value.creatorId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creatorId"],
        message: "creatorId is only allowed when type is 'creator'",
      });
    }
  });
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// One flat entry shape covering all board types. `score` is type-specific
// (xp/cards/badges counts or — for `creator` — total owned cards of that
// creator). `reachedAt` powers the tie-break (earlier ranks higher).
export const leaderboardEntrySchema = z.object({
  rank: z.number().int().min(1),
  userId: z.string().uuid(),
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  totalXp: z.number().int(),
  level: z.number().int().min(1).max(100),
  tier: levelTierSchema,
  score: z.number().int().min(0),
  reachedAt: z.iso.datetime(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

// ── Domain Types ───────────────────────────────────────────────────────────
export interface Drop {
  id: string;
  title: string;
  series: string;
  narrative: string;
  artworkUrl: string;
  artwork3dUrl?: string | null;
  totalUnits: number;
  signedCount: number;
  unsignedCount: number;
  priceCCoin?: number; // canonical (MVP)
  priceUnsignedCCoin: number; // kept for UI backwards compat
  priceSignedCCoin: number;
  status: DropStatus;
  dropStartAt: string | null;
  dropEndAt?: string | null;
  creatorId: string;
  creatorName: string;
  soldCount: number;
  remainingUnits: number;
  createdAt: string;
}

export interface Card {
  id: string;
  dropId: string;
  unitNumber: number;
  variant: "unsigned" | "signed";
  // new canonical
  location?: CardLocation;
  cardStatus?: CardStatus;
  buyoutPriceCcoin?: number | null;
  // legacy compat
  status: CardStatus | "available" | "sold" | "listed" | "transferred";
  ownerId: string | null;
  nfcUid: string | null;
  nfcShortId: string;
  verifyStatus: VerifyStatus;
}

export interface Wallet {
  userId: string;
  balanceCCoin: number;
  balanceIdrEquiv: number;
  totalTopupCCoin: number;
  totalSpentCCoin: number;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: WalletTxType | string; // string fallback for legacy "topup"/"checkout"
  amountCCoin: number;
  balanceAfterCCoin: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  metadata?: Record<string, unknown> | null;
  feeCcoin?: number | null;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  dropId: string;
  cardId?: string; // 1 card = 1 order
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  deliveryOption?: DeliveryOption;
  shippingFeeCcoin?: number | null;
  escrowStatus?: EscrowStatus;
  shippingAddress: string | null;
  trackingNumber: string | null;
  createdAt: string;
  // P1-4 (audit 2026-08-24): timestamp per step timeline (paid_at / shipped_at / delivered_at).
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
}

export interface Shipment {
  id: string;
  cardId: string;
  requesterId: string;
  type: ShipmentType;
  toDest: ShipmentToDest;
  address: string | null;
  feeCcoin: number | null;
  status: ShipmentStatus;
  trackingNumber: string | null;
  createdAt: string;
}

export interface Bid {
  id: string;
  cardId: string;
  bidderId: string;
  bidderName: string;
  amountCCoin: number;
  amountCcoin?: number;
  status?: BidStatus;
  createdAt: string;
}

export interface Badge {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
  xpReward?: number;
  criteria?: unknown;
}

export interface UserBadge {
  badgeId: string;
  earnedAt: string;
  badge: Badge;
}

// ── Gamification ───────────────────────────────────────────────────────────
export function calcSignedCount(totalUnits: number): number {
  return Math.ceil(totalUnits / 10);
}
export function calcUnsignedCount(totalUnits: number): number {
  return totalUnits - calcSignedCount(totalUnits);
}

/**
 * Galactic Rank Ladder — 10 bands × 10 levels each.
 * docs/05-data-model + 07 C-05c. Enum values are lowercase Indonesian cosmic
 * words that double as UI labels via existing `.toUpperCase()` renders; no
 * separate translation map layer is required.
 *
 *   1–10  orbit    ·  11–20  meteor   ·  21–30  komet    ·  31–40  planet
 *  41–50  nebula   ·  51–60  nova     ·  61–70  supernova · 71–80  pulsar
 *  81–90  kuasar   ·  91–100 galaksi
 */
export const LEVEL_TIERS = [
  "orbit",
  "meteor",
  "komet",
  "planet",
  "nebula",
  "nova",
  "supernova",
  "pulsar",
  "kuasar",
  "galaksi",
] as const satisfies readonly LevelTier[];
export type LevelTierValue = (typeof LEVEL_TIERS)[number];

/** docs/05-data-model + 07 C-05c: level = floor(total_xp / 10) + 1; top-up does NOT add XP */
export function calcLevel(xp: number): { level: number; tier: LevelTier } {
  const safe = Math.max(0, Math.floor(xp));
  // xp 0-9 => level 1, 10-19 => level 2, etc. clamp 1..100
  const level = Math.min(100, Math.max(1, Math.floor(safe / 10) + 1));
  // Band selection: each band covers 10 levels (1..10, 11..20, ..., 91..100).
  // `Math.min(9, ...)` caps the index so a (defensive) level=100 still resolves
  // to the last band even though floor((100-1)/10) === 9 already.
  const bandIndex = Math.min(LEVEL_TIERS.length - 1, Math.floor((level - 1) / 10));
  const tier: LevelTier = LEVEL_TIERS[bandIndex];
  return { level, tier };
}
export function xpForNextLevel(xp: number): number {
  const { level } = calcLevel(xp);
  return level * 10 - xp;
}

// ── Pricing: signed price rule ────────────────────────────────────────────────
// Founder 2026-08-16: priceSigned = priceUnsigned + 20 C-Coin (FLAT, bukan multiplier) — 20/40, 40/60, 50/70.
export const SIGNED_PRICE_DELTA_CCOIN = 20;
export function calcSignedPrice(priceCcoin: number): number {
  return priceCcoin + SIGNED_PRICE_DELTA_CCOIN;
}

// ── Limits & thresholds (canonical — jangan hard-code di app/SQL) ──────────
// KYC wajib untuk payout (docs 07 C-05b); top-up non-KYC dibatasi BALANCE_CAP_CCOIN.
export const MAX_BUYOUT_ACTIVE_PER_USER = 20;
export const MAX_ACTIVE_BIDS_PER_USER = 3; // keputusan founder 2026-08-16
export const MIN_PAYOUT_CCOIN = 10; // docs/07 C-09b: minimum payout 10 C-Coin (Rp 100rb)
// Dual-token C-Coin/C-Gems (docs/07): Gems hasil penjualan/support baru bisa
// dicairkan (payout_request -> PAYOUT_GEMS_LOCKED) setelah masa kunci habis.
export const GEMS_LOCK_HOURS = 24;
export const BALANCE_CAP_CCOIN = 500; // cap saldo top-up non-KYC (docs 07 C-08, founder 2026-08-16); KYC approved = tanpa cap
export const ESCROW_RELEASE_DELAY_DAYS = 7; // escrow shipping auto-release DELIVERED + H+7
// Owner directive 2026-09-01: bid baru bisa dibatalkan 24 jam setelah dipasang —
// dieksekusi RPC cancel_bid (BID_CANCEL_COOLDOWN) + diekspos ke viewer sebagai
// activeBid.canCancelAt (GET /api/nfc/cards/:cardId, hanya untuk bid miliknya).
// Komplemen C-12 rebuy cooldown (COOLING_PERIOD_24H) yang berlaku SETELAH
// cancel/jual — window cancel vs window rebuy adalah dua kunci berbeda.
export const BID_CANCEL_COOLDOWN_HOURS = 24;

// Guards
export function isCcoinInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

// ── UI status labels (canonical) ────────────────────────────────────────────
// Enum backend disimpan snake_case/English; UI berbahasa Indonesia. Pusatkan
// pemetaan di sini agar semua halaman menampilkan label yang sama, dan fallback
// ke nilai mentah supaya status tak dikenal tidak pernah membuat UI crash.
function labelFrom(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

const DROP_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Segera",
  published: "Live",
  live: "Live",
  sold_out: "Habis",
  closed: "Berakhir",
  cancelled: "Dibatalkan",
};
export function dropStatusLabel(status: string): string {
  return labelFrom(DROP_STATUS_LABELS, status);
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Dibayar",
  qc: "Pemeriksaan",
  shipped: "Dikirim",
  delivered: "Diterima",
  settled: "Selesai",
  refunded: "Dana kembali",
  disputed: "Sengketa",
  cancelled: "Dibatalkan",
};
export function orderStatusLabel(status: string): string {
  return labelFrom(ORDER_STATUS_LABELS, status);
}

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  requested: "Diminta",
  packed: "Dikemas",
  shipped: "Dikirim",
  delivered: "Diterima",
  cancelled: "Dibatalkan",
};
export function shipmentStatusLabel(status: string): string {
  return labelFrom(SHIPMENT_STATUS_LABELS, status);
}

const CARD_LOCATION_LABELS: Record<string, string> = {
  platform_stock: "Stok platform",
  platform_vault: "Di vault",
  with_owner: "Dimiliki",
};
export function cardLocationLabel(location: string): string {
  return labelFrom(CARD_LOCATION_LABELS, location);
}

const KYC_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
};
export function kycStatusLabel(status: string): string {
  return labelFrom(KYC_STATUS_LABELS, status);
}

const WALLET_TX_TYPE_LABELS: Record<string, string> = {
  top_up: "Top-up",
  topup: "Top-up",
  checkout: "Pembelian",
  escrow_hold: "Escrow ditahan",
  escrow_release: "Escrow lepas",
  settlement: "Settlement",
  payout: "Penarikan",
  payout_refund: "Refund penarikan",
  royalty: "Royalti",
  refund: "Dana kembali",
  adjustment: "Penyesuaian",
  platform_buy: "Pembelian platform",
  platform_revenue: "Pendapatan platform",
  seed_abort: "Refund seed",
  vault_shipout: "Kirim dari vault",
  support: "Dukungan",
  convert: "Konversi ke C-Coin",
};
export function walletTxTypeLabel(type: string): string {
  return labelFrom(WALLET_TX_TYPE_LABELS, type);
}

const ESCROW_STATUS_LABELS: Record<string, string> = {
  held: "Ditahan",
  released: "Dilepas",
};
export function escrowStatusLabel(status: string): string {
  return labelFrom(ESCROW_STATUS_LABELS, status);
}

// Status entry raffle (drop_entries.status): held -> won_* saat draw; kalah
// dilepas via cron (lost -> refunded). Label lowercase "ditahan" sengaja —
// mengikuti konteks "N C ditahan" di pill DropDetail.
const DROP_ENTRY_STATUS_LABELS: Record<string, string> = {
  held: "ditahan",
  won_premium: "Menang",
  won_regular: "Menang",
  lost: "Dana kembali",
  refunded: "Dana kembali",
};
export function dropEntryStatusLabel(status: string): string {
  return labelFrom(DROP_ENTRY_STATUS_LABELS, status);
}

const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  primary_shipping: "Kirim ke alamat",
  primary_vault: "Simpan di vault",
  secondary_buyout: "Buyout — antar ke vault",
  secondary_bid: "Bid diterima — antar ke vault",
  vault_shipout: "Kirim dari vault",
  secondary_seller_to_vault: "Kirim ke vault (verifikasi)",
};
export function shipmentTypeLabel(type: string): string {
  return labelFrom(SHIPMENT_TYPE_LABELS, type);
}

const SHIPMENT_TO_DEST_LABELS: Record<string, string> = {
  buyer_address: "alamat pembeli",
  platform_vault: "vault",
};
export function shipmentToDestLabel(dest: string): string {
  return labelFrom(SHIPMENT_TO_DEST_LABELS, dest);
}

// Varian C.Card: signed = Premium (Signed), unsigned = Reguler — label yang
// sama dipakai grup unit di halaman drop agar konsisten antar halaman.
const CARD_VARIANT_LABELS: Record<string, string> = {
  signed: "Premium (Signed)",
  unsigned: "Reguler",
};
export function cardVariantLabel(variant: string): string {
  return labelFrom(CARD_VARIANT_LABELS, variant);
}
