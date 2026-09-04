// Domain types (docs/05-data-model) — dipakai mapper reads.ts & route responses.
// Enum types canonical di @c-verse/shared — tidak ada legacy extend.

import type {
  BidStatus as SharedBidStatus,
  CardLocation as SharedCardLocation,
  CardStatus as SharedCardStatus,
  DeliveryOption as SharedDeliveryOption,
  DropStatus as SharedDropStatus,
  EscrowStatus as SharedEscrowStatus,
  KycStatus as SharedKycStatus,
  OrderStatus as SharedOrderStatus,
  ShipmentStatus as SharedShipmentStatus,
  ShipmentToDest as SharedShipmentToDest,
  ShipmentType as SharedShipmentType,
  VerifyStatus as SharedVerifyStatus,
  WalletTxType as SharedWalletTxType,
} from "@c-verse/shared";

// ── Types (align docs/05-data-model) ───────────────────────────────────────
export type UserRole = "user" | "creator" | "admin";
export type DropStatus = SharedDropStatus;
export type OrderStatus = SharedOrderStatus;
export type DeliveryOption = SharedDeliveryOption;
export type EscrowStatus = SharedEscrowStatus;
export type CardLocation = SharedCardLocation;
export type CardStatus = SharedCardStatus;
export type ShipmentType = SharedShipmentType;
export type ShipmentToDest = SharedShipmentToDest;
export type ShipmentStatus = SharedShipmentStatus;
export type BidStatus = SharedBidStatus;
export type VerifyStatus = SharedVerifyStatus;
export type KycStatus = SharedKycStatus;
export type WalletTxType = SharedWalletTxType;

export interface User {
  id: string;
  email: string;
  displayName: string;
  username?: string | null;
  usernameIsAuto?: boolean;
  role: UserRole;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
  cumulativeSpendCcoin: number;
  isAnonymous: boolean;
  flagReason: string | null;
  consentAnalyticsDetail: boolean;
  consentDataMarket: boolean;
  createdAt: string;
}

export interface CreatorRec {
  id: string;
  userId: string | null;
  handle: string;
  totalFollowersCombined: number;
  status: "active" | "suspended" | "inactive";
  bankAccount: Record<string, string> | null;
  notes: string | null;
  createdAt: string;
}

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
  priceUnsignedCCoin: number;
  priceSignedCCoin: number;
  priceCcoin: number;
  status: DropStatus;
  dropStartAt: string | null;
  dropEndAt: string | null;
  raffleEndAt?: string | null;
  drawnAt?: string | null;
  creatorId: string;
  creatorName: string;
  soldCount: number;
  createdAt: string;
  createdBy?: string | null;
  isSeed: boolean;
}

export interface Card {
  id: string;
  dropId: string;
  unitNumber: number;
  variant: "unsigned" | "signed";
  status: CardStatus;
  location: CardLocation;
  buyoutPriceCcoin: number | null;
  nfcConfigured: boolean;
  qcStatus: "pending" | "passed" | "failed";
  ownerId: string | null;
  nfcUid: string;
  nfcShortId: string;
  verifyStatus: VerifyStatus;
  lastCtr: number;
  createdAt?: string;
}

export interface Wallet {
  userId: string;
  balanceCCoin: number;
  balanceGems: number;
  totalTopupCCoin: number;
  totalSpentCCoin: number;
  holdPayoutUntil: string | null;
  updatedAt?: string;
}

// Dual-token C-Coin/C-Gems (docs/07): wallet read untuk route wallet menyertakan
// breakdown kesiapan cair — gemsLocked = balanceGems − gemsMatured (belum lewat
// masa kunci GEMS_LOCK_HOURS).
export interface WalletGems extends Wallet {
  gemsMatured: number;
  gemsLocked: number;
}

export interface WalletTx {
  id: string;
  userId: string;
  type: string;
  amountCCoin: number;
  balanceAfterCCoin: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface Order {
  id: string;
  userId: string;
  dropId: string;
  cardId: string | null;
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  deliveryOption: DeliveryOption;
  shippingFeeCcoin: number | null;
  escrowStatus: EscrowStatus;
  shippingAddress: string | null;
  trackingNumber: string | null;
  // P1-4 (audit 2026-08-24): timestamp per step timeline.
  shippedAt?: string | null;
  deliveredAt: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface Shipment {
  id: string;
  cardId: string;
  requesterId: string;
  type: ShipmentType;
  fromLocation: "platform" | "seller";
  toDest: ShipmentToDest;
  address: string | Record<string, unknown> | null;
  feeCcoin: number | null;
  status: ShipmentStatus;
  trackingNumber: string | null;
  platformCheck?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Bid {
  id: string;
  cardId: string;
  bidderId: string;
  bidderName: string;
  amountCCoin: number;
  status: BidStatus;
  createdAt: string;
  outbidAt?: string | null;
  cancelledAt?: string | null;
  acceptedAt?: string | null;
}

export interface BadgeDef {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  iconUrl?: string | null;
  xp: number;
  xpReward: number;
  criteria?: Record<string, unknown> | null;
  isActive?: boolean;
}

export interface UserBadge {
  userId: string;
  badgeId: string;
  earnedAt: string;
  awardedAt?: string;
  xpRewardSnapshot?: number;
}

export interface KycRecord {
  id: string;
  userId: string;
  fullName: string;
  nik: string;
  address: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt?: string;
  // KTP + selfie wajib dan NPWP opsional. Hanya object key privat Cloudflare R2
  // yang disimpan di Postgres; file tidak pernah berada di Supabase Storage.
  dob?: string | null;
  ktpObjectKey?: string | null;
  npwpObjectKey?: string | null;
  selfieObjectKey?: string | null;
}

export interface OwnershipHistory {
  id: string;
  cardId: string;
  ownerId: string;
  acquiredVia: "primary" | "secondary_buyout" | "secondary_bid" | "gift";
  orderId: string | null;
  bidId: string | null;
  transferredAt: string;
}

export interface AuditLog {
  id: string;
  adminUserId: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  payloadSummary: Record<string, unknown> | null;
  ip: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface CreatorPageView {
  id: string;
  creatorId: string;
  viewedAt: string;
  referrer: string | null;
  city: string | null;
  userId: string | null;
}

export interface QcDefect {
  id: string;
  cardId: string;
  defectType: "dus" | "acrylic" | "kartu" | "nfc";
  severity: "minor" | "major" | "critical";
  notes: string | null;
  resolution: "redistribute" | "destroy" | "return_vendor" | null;
  redistributeDiscountPct: number | null;
  createdAt: string;
}

// ── Id/timestamp helpers (pure — no data access) ───────────────────────────
/** Cryptographically-strong lowercase hex string, `byteLength` bytes (2× chars). */
export function randomHex(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}
export function uid(prefix = ""): string {
  // crypto randomness (not Math.random) so ids are collision-safe as DB primary keys;
  // time suffix keeps them roughly sortable by creation.
  return prefix + randomHex(6) + Date.now().toString(36).slice(-4);
}
export function nowIso(): string {
  return new Date().toISOString();
}
