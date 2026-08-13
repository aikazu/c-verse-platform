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

// ── Domain & product shape ─────────────────────────────────────────────────
export const PRIMARY_DOMAIN = "c-verse.co"; // 00-README: must lock before NFC provisioning
export const SECONDARY_DOMAIN = "c-verse.id";
export const CREATOR_THRESHOLD_FOLLOWERS = 100_000; // combined — off-platform validated

// ── Enums (align docs/05-data-model) ──────────────────────────────────────
export const userRoleSchema = z.enum(["user", "creator", "admin"]);
// backwards alias for older code importing "collector"
export const legacyCollectorRole = "user" as const;
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

export const walletTxTypeSchema = z.enum(["top_up", "checkout", "escrow_hold", "escrow_release", "settlement", "payout", "royalty", "refund", "adjustment"]);
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

// Legacy — kept for incremental migration (old marketplace auction code).
// New code should use cardLocation/cardStatus/bidStatus; avoid listingStatus.
export const listingStatusSchema = z.enum(["draft", "listed", "bidding", "awaiting_settlement", "settled", "expired", "cancelled", "failed"]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;
export const listingTypeSchema = z.enum(["fixed", "auction"]);
export type ListingType = z.infer<typeof listingTypeSchema>;

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
  deliveryOption: deliveryOptionSchema.default("shipping"),
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

export const createListingSchema = z.object({
  cardId: z.string().min(1),
  type: z.enum(["fixed", "auction"]).default("fixed"),
  priceCCoin: z.number().int().min(1),
  reserveCCoin: z.number().int().min(0).optional(),
  durationDays: z.number().int().min(1).max(14).default(7),
});

export const bidSchema = z.object({
  listingId: z.string().min(1),
  amountCCoin: z.number().int().min(1),
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

export interface Listing {
  id: string;
  cardId: string;
  sellerId: string;
  type: "fixed" | "auction";
  priceCCoin: number;
  reserveCCoin: number | null;
  currentBidCCoin: number | null;
  currentBidderId: string | null;
  status: ListingStatus;
  endsAt: string;
  createdAt: string;
}

export interface Bid {
  id: string;
  cardId?: string; // new: bid directly on card
  listingId: string; // legacy, kept
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

/** docs/05-data-model + 07 C-05c: level = floor(total_xp / 10); top-up does NOT add XP */
export function calcLevel(xp: number): { level: number; tier: LevelTier } {
  const safe = Math.max(0, Math.floor(xp));
  const level = Math.max(1, Math.floor(safe / 10) + (safe >= 0 ? 0 : 0));
  // xp 0-9 => level 1 — guard so 0 xp is still level 1
  const lvl = Math.min(100, Math.max(1, Math.floor(safe / 10) + 1 > 100 ? 100 : Math.floor(safe / 10) + 1));
  // above floors: 0-9 =>1, 10-19=>2 etc. clamp 1..100
  let tier: LevelTier = "bronze";
  if (lvl >= 41) tier = "diamond";
  else if (lvl >= 31) tier = "platinum";
  else if (lvl >= 21) tier = "gold";
  else if (lvl >= 11) tier = "silver";
  return { level: lvl, tier };
}
export function xpForNextLevel(xp: number): number {
  const { level } = calcLevel(xp);
  return level * 10 - xp;
}

// KYC triggers per docs/07 C-05b
export const KYC_TRIGGER_THRESHOLD_CCOIN = 99;
export const MAX_BUYOUT_ACTIVE_PER_USER = 20;

// Guards
export function isCcoinInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}
