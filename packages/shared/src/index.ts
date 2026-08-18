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
  if (!Number.isFinite(idr) || idr < 0) return Number.NaN; // guard: invalid nominal
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
export const SECONDARY_FEE_PCT = 0.15; // 15% total secondary
export const SECONDARY_PLATFORM_PCT = 0.075;
export const SECONDARY_ROYALTY_PCT = 0.075;
export const SECONDARY_SELLER_PCT = 0.85;
export const REVENUE_SHARE_PLATFORM_PRODUCED = { platform: 0.7, creator: 0.3 } as const;
export const REVENUE_SHARE_CREATOR_PRODUCED = { platform: 0.3, creator: 0.7 } as const; // deferred Y2+ (not in MVP)

/**
 * Secondary sale fee split (15% total: 7.5 platform + 7.5 royalty + 85 seller).
 * Integer C-Coin: platform/royalty rounded to nearest, seller takes the remainder
 * so the three parts always sum exactly to the sale price.
 */
export function splitSecondaryFeeCcoin(priceCcoin: number): { platformCcoin: number; royaltyCcoin: number; sellerCcoin: number } {
  const platformCcoin = Math.round(priceCcoin * SECONDARY_PLATFORM_PCT);
  const royaltyCcoin = Math.round(priceCcoin * SECONDARY_ROYALTY_PCT);
  return { platformCcoin, royaltyCcoin, sellerCcoin: priceCcoin - platformCcoin - royaltyCcoin };
}

// ── Domain & product shape ─────────────────────────────────────────────────
export const PRIMARY_DOMAIN = "c-verse.co"; // 00-README: must lock before NFC provisioning
export const SECONDARY_DOMAIN = "c-verse.id";
export const CREATOR_THRESHOLD_FOLLOWERS = 100_000; // combined — off-platform validated

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

export const shipmentTypeSchema = z.enum(["primary_shipping", "primary_vault", "secondary_buyout", "secondary_bid", "vault_shipout"]);
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
  "royalty",
  "refund",
  "adjustment",
  "platform_buy",
  "platform_revenue",
]);
export type WalletTxType = z.infer<typeof walletTxTypeSchema>;

export const verifyStatusSchema = z.enum(["verified", "tamper_detected", "registered", "unknown"]);
// docs/03 flow 4: server maps QR-without-CMAC to "registered" (weaker label)
export type VerifyStatus = z.infer<typeof verifyStatusSchema>;

export const bidStatusSchema = z.enum(["active", "outbid", "cancelled", "accepted"]);
export type BidStatus = z.infer<typeof bidStatusSchema>;

export const kycStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type KycStatus = z.infer<typeof kycStatusSchema>;

export const levelTierSchema = z.enum(["bronze", "silver", "gold", "platinum", "diamond"]);
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
  dropStartAt: z.string().datetime().optional(),
  dropEndAt: z.string().datetime().optional(),
  dropAt: z.string().datetime().optional(), // legacy alias for dropStartAt
  creatorId: z.string().optional(),
});
export type CreateDropInput = z.infer<typeof createDropSchema>;

// Checkout: single-card, 1 kartu/user/drop, delivery option + on-chain shipping fee (integer >=1)
export const checkoutSchema = z.object({
  dropId: z.string().min(1),
  deliveryOption: deliveryOptionSchema.default("vault"), // C-10 FINAL: vault default, shipping = opt-in
  shippingFeeCcoin: z.number().int().min(1).nullable().optional(), // required when shipping; must be >=1 (no fractional)
  shippingAddress: z.string().min(10).max(500).nullable().optional(), // required when shipping
  // legacy fields (accept but ignore/convert)
  quantity: z.number().int().min(1).max(1).optional(),
  variant: z.enum(["unsigned", "signed"]).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Secondary: set buyout price on owned card (KYC gate before)
export const setBuyoutSchema = z.object({
  cardId: z.string().min(1),
  buyoutPriceCcoin: z.number().int().min(1).nullable(), // null = cabut buyout
});
export type SetBuyoutInput = z.infer<typeof setBuyoutSchema>;

// Bids: directly on card (no listing indirection). 1 active per card; outbid auto-release.
export const placeBidSchema = z.object({
  cardId: z.string().min(1),
  amountCcoin: z.number().int().min(1),
  // legacy alias
  amountCCoin: z.number().int().min(1).optional(),
  listingId: z.string().optional(), // legacy — ignored if cardId present
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const acceptBidSchema = z.object({
  bidId: z.string().min(1).optional(), // optional: if omitted, accept current active bid on card
  destination: shipmentToDestSchema.optional().default("buyer_address"), // secondary buyer chooses ship dest
  shippingAddress: z.string().min(10).max(500).nullable().optional(),
  shippingFeeCcoin: z.number().int().min(1).nullable().optional(),
});
export type AcceptBidInput = z.infer<typeof acceptBidSchema>;

export const cancelBidSchema = z.object({
  bidId: z.string().min(1),
});

export const vaultShipoutSchema = z.object({
  cardId: z.string().min(1),
  address: z.string().min(10).max(500),
  feeCcoin: z.number().int().min(1),
});
export type VaultShipoutInput = z.infer<typeof vaultShipoutSchema>;

export const topupSchema = z.object({
  amountCCoin: z.number().int().min(1).max(10000),
  amountCcoin: z.number().int().min(1).max(10000).optional(), // alias
  method: z.enum(["qris", "va_bca", "va_mandiri", "ewallet_gopay", "ewallet_ovo"]).default("qris"),
});

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
  dropAt: string | null; // alias to dropStartAt
  dropStartAt?: string | null;
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
  cardIds: string[];
  cardId?: string; // canonical 1 card = 1 order
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  deliveryOption?: DeliveryOption;
  shippingFeeCcoin?: number | null;
  escrowStatus?: EscrowStatus;
  shippingAddress: string | null;
  trackingNumber: string | null;
  createdAt: string;
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

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  level: number;
  tier: LevelTier;
  xp: number;
  totalSpentCCoin: number;
}

// ── Gamification ───────────────────────────────────────────────────────────
export function calcSignedCount(totalUnits: number): number {
  return Math.ceil(totalUnits / 10);
}
export function calcUnsignedCount(totalUnits: number): number {
  return totalUnits - calcSignedCount(totalUnits);
}

/** docs/05-data-model + 07 C-05c: level = floor(total_xp / 10) + 1; top-up does NOT add XP */
export function calcLevel(xp: number): { level: number; tier: LevelTier } {
  const safe = Math.max(0, Math.floor(xp));
  // xp 0-9 => level 1, 10-19 => level 2, etc. clamp 1..100
  const level = Math.min(100, Math.max(1, Math.floor(safe / 10) + 1));
  let tier: LevelTier = "bronze";
  if (level >= 41) tier = "diamond";
  else if (level >= 31) tier = "platinum";
  else if (level >= 21) tier = "gold";
  else if (level >= 11) tier = "silver";
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
export const BALANCE_CAP_CCOIN = 500; // cap saldo top-up non-KYC (docs 07 C-08, founder 2026-08-16); KYC approved = tanpa cap
export const ESCROW_RELEASE_DELAY_DAYS = 7; // escrow shipping auto-release DELIVERED + H+7

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
  royalty: "Royalti",
  refund: "Dana kembali",
  adjustment: "Penyesuaian",
  platform_buy: "Pembelian platform",
  platform_revenue: "Pendapatan platform",
};
export function walletTxTypeLabel(type: string): string {
  return labelFrom(WALLET_TX_TYPE_LABELS, type);
}
