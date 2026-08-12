import { z } from "zod";

// ── Constants (source: 00_foundation/05_assumptions.md, 90_research/*.md) ──
export const C_COIN_RATE_IDR = 10_000; // 1 C-Coin = Rp 10.000 (KEPUTUSAN USER 2026-08-11)
export const AOV_UNSIGNED_IDR = 300_000;
export const AOV_SIGNED_IDR = 500_000;
export const AOV_UNSIGNED_CCOIN = AOV_UNSIGNED_IDR / C_COIN_RATE_IDR; // 30
export const AOV_SIGNED_CCOIN = AOV_SIGNED_IDR / C_COIN_RATE_IDR; // 50
export const PAYOUT_FEE_PCT = 0.01; // 1% payout fee
export const SECONDARY_FEE_PCT = 0.15; // 15% total secondary fee
export const SECONDARY_PLATFORM_PCT = 0.075;
export const SECONDARY_ROYALTY_PCT = 0.075;
export const SECONDARY_SELLER_PCT = 0.85;
export const REVENUE_SHARE_PLATFORM_PRODUCED = { platform: 0.7, creator: 0.3 } as const;
export const REVENUE_SHARE_CREATOR_PRODUCED = { platform: 0.3, creator: 0.7 } as const;

// ── Helpers ──
export function idrToCCoin(idr: number): number {
  return Math.round(idr / C_COIN_RATE_IDR);
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

// ── Zod Schemas ──
export const userRoleSchema = z.enum(["collector", "creator", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const dropStatusSchema = z.enum(["draft", "review", "approved", "production", "scheduled", "live", "ended", "cancelled"]);
export type DropStatus = z.infer<typeof dropStatusSchema>;

export const orderStatusSchema = z.enum(["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const listingStatusSchema = z.enum(["draft", "listed", "bidding", "awaiting_settlement", "settled", "expired", "cancelled", "failed"]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

export const walletTxTypeSchema = z.enum(["topup", "checkout", "refund", "payout", "royalty", "fee", "hold", "release"]);
export type WalletTxType = z.infer<typeof walletTxTypeSchema>;

export const verifyStatusSchema = z.enum(["verified", "tamper_detected", "registered", "unknown"]);
export type VerifyStatus = z.infer<typeof verifyStatusSchema>;

export const levelTierSchema = z.enum(["bronze", "silver", "gold", "platinum", "diamond"]);
export type LevelTier = z.infer<typeof levelTierSchema>;

// ── API Schemas ──
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
  totalUnits: z.number().int().min(1).max(1000),
  priceUnsignedCCoin: z.number().int().min(1).default(AOV_UNSIGNED_CCOIN),
  priceSignedCCoin: z.number().int().min(1).default(AOV_SIGNED_CCOIN),
  dropAt: z.string().datetime().optional(),
  creatorId: z.string().optional(),
});

export const checkoutSchema = z.object({
  dropId: z.string().min(1),
  quantity: z.number().int().min(1).max(2).default(1),
  variant: z.enum(["unsigned", "signed"]).default("unsigned"),
  shippingAddress: z.string().min(10).max(500),
});

export const topupSchema = z.object({
  amountCCoin: z.number().int().min(1).max(10000),
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

// ── Types ──
export interface Drop {
  id: string;
  title: string;
  series: string;
  narrative: string;
  artworkUrl: string;
  totalUnits: number;
  signedCount: number;
  unsignedCount: number;
  priceUnsignedCCoin: number;
  priceSignedCCoin: number;
  status: DropStatus;
  dropAt: string | null;
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
  status: "available" | "sold" | "listed" | "transferred";
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
  type: WalletTxType;
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
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  shippingAddress: string;
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
  listingId: string;
  bidderId: string;
  bidderName: string;
  amountCCoin: number;
  createdAt: string;
}

export interface Badge {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
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

export function calcSignedCount(totalUnits: number): number {
  return Math.ceil(totalUnits / 10);
}
export function calcUnsignedCount(totalUnits: number): number {
  return totalUnits - calcSignedCount(totalUnits);
}
export function calcLevel(xp: number): { level: number; tier: LevelTier } {
  const level = Math.min(50, Math.floor(xp / 200) + 1);
  let tier: LevelTier = "bronze";
  if (level >= 41) tier = "diamond";
  else if (level >= 31) tier = "platinum";
  else if (level >= 21) tier = "gold";
  else if (level >= 11) tier = "silver";
  return { level, tier };
}
