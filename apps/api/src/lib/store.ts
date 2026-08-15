// Domain types (docs/05-data-model) — dipakai mapper reads.ts & route responses.

// ── Types (align docs/05-data-model) ───────────────────────────────────────
export type UserRole = "user" | "creator" | "admin";
export type LegacyCollector = "collector"; // alias
export type AnyRole = UserRole | LegacyCollector;
export type DropStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "live"
  | "sold_out"
  | "closed"
  | "cancelled"
  | "review"
  | "approved"
  | "production"
  | "ended";
export type OrderStatus =
  | "paid"
  | "qc"
  | "shipped"
  | "delivered"
  | "settled"
  | "refunded"
  | "disputed"
  | "pending"
  | "processing"
  | "cancelled";
export type DeliveryOption = "shipping" | "vault";
export type EscrowStatus = "held" | "released";
export type CardLocation = "platform_stock" | "with_owner" | "platform_vault";
export type CardStatus =
  | "inventory"
  | "bound"
  | "listed_buyout"
  | "bid_pending"
  | "sold"
  | "tampered"
  | "defect"
  | "lost"
  | "available"
  | "listed"
  | "transferred";
export type ShipmentType = "primary_shipping" | "primary_vault" | "secondary_buyout" | "secondary_bid" | "vault_shipout";
export type ShipmentToDest = "buyer_address" | "platform_vault";
export type ShipmentStatus = "requested" | "packed" | "shipped" | "delivered" | "cancelled";
export type BidStatus = "active" | "outbid" | "cancelled" | "accepted";
export type VerifyStatus = "verified" | "tamper_detected" | "registered" | "unknown";
export type ListingStatus = never; // legacy auction/listing removed (C-07 FINAL)

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  username?: string | null;
  role: AnyRole;
  avatarUrl: string | null;
  xp: number; // legacy
  totalXp: number;
  level: number;
  cumulativeSpendCcoin: number;
  isAnonymous: boolean;
  flagReason: string | null; // docs 05: fraud flag reason (admin manual)
  consentAnalyticsDetail: boolean; // docs 09 3.4
  consentDataMarket: boolean; // docs 09 3.4
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
  priceCcoin: number; // canonical single price (MVP platform-produced)
  status: DropStatus;
  dropAt: string | null; // legacy
  dropStartAt: string | null;
  dropEndAt: string | null;
  raffleEndAt?: string | null; // C-15 hybrid raffle window
  drawnAt?: string | null; // idempotency marker for draw_drop
  creatorId: string;
  creatorName: string;
  soldCount: number;
  createdAt: string;
  createdBy?: string | null;
}

export interface Card {
  id: string;
  dropId: string;
  unitNumber: number;
  variant: "unsigned" | "signed";
  status: CardStatus;
  // new canonical
  location: CardLocation;
  buyoutPriceCcoin: number | null; // null = not listed
  nfcConfigured: boolean;
  qcStatus: "pending" | "passed" | "failed";
  ownerId: string | null;
  nfcUid: string;
  nfcShortId: string;
  verifyStatus: VerifyStatus;
  lastCtr: number; // NTAG 424 DNA SUN read counter (anti-replay)
  createdAt?: string;
}

export interface Wallet {
  userId: string;
  balanceCCoin: number;
  totalTopupCCoin: number;
  totalSpentCCoin: number;
  holdPayoutUntil: string | null; // docs 05 wallets.hold_payout_until
  updatedAt?: string;
}

export interface WalletTx {
  id: string;
  userId: string;
  type: string; // topup/checkout/... may be top_up etc.
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
  cardIds: string[]; // legacy multi
  cardId: string | null; // canonical 1:1
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  deliveryOption: DeliveryOption;
  shippingFeeCcoin: number | null;
  escrowStatus: EscrowStatus;
  shippingAddress: string | null;
  trackingNumber: string | null;
  shippedAt?: string | null;
  deliveredAt: string | null;
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
  creatorId: string; // FK creators.id
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
  redistributeDiscountPct: number | null; // 10-30 if redistribute
  createdAt: string;
}

// ── Id/timestamp helpers (pure — no data access) ───────────────────────────
export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
export function nowIso(): string {
  return new Date().toISOString();
}
