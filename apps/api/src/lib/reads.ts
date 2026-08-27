import type { SupabaseClient } from "@supabase/supabase-js";
import type { BadgeDef, Bid, Card, CreatorRec, Drop, KycRecord, Order, Shipment, User, UserBadge, Wallet, WalletTx } from "./store.js";
import { getSupabase } from "./supabase.js";

// Read facade (docs/13 §3 Wave 1-5): read-only SELECT via Supabase — DB wajib,
// tanpa fallback in-memory. Writes uang & stok tetap WAJIB lewat RPC (lib/db.ts).
// Mapper mengembalikan bentuk camelCase yang dipakai respons route.

export type Row = Record<string, unknown>;

export function readDb(): SupabaseClient {
  return getSupabase();
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0);
const nnum = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === "true";

export function mapDropRow(r: Row): Drop {
  return {
    id: str(r.id),
    title: str(r.title),
    series: str(r.series),
    narrative: str(r.narrative),
    artworkUrl: str(r.artwork_url),
    artwork3dUrl: nstr(r.artwork_3d_url),
    totalUnits: num(r.total_units),
    signedCount: num(r.signed_count),
    unsignedCount: num(r.unsigned_count),
    priceUnsignedCCoin: num(r.price_unsigned_ccoin),
    priceSignedCCoin: num(r.price_signed_ccoin),
    priceCcoin: num(r.price_ccoin),
    status: str(r.status) as Drop["status"],
    dropAt: nstr(r.drop_at),
    dropStartAt: nstr(r.drop_start_at),
    dropEndAt: nstr(r.drop_end_at),
    raffleEndAt: nstr(r.raffle_end_at),
    drawnAt: nstr(r.drawn_at),
    creatorId: str(r.creator_id),
    creatorName: str(r.creator_name),
    soldCount: num(r.sold_count),
    createdAt: str(r.created_at),
    createdBy: nstr(r.created_by),
    isSeed: bool(r.is_seed),
  };
}

export function mapCardRow(r: Row): Card {
  return {
    id: str(r.id),
    dropId: str(r.drop_id),
    unitNumber: num(r.unit_number),
    variant: str(r.variant) as Card["variant"],
    status: str(r.status) as Card["status"],
    location: str(r.location) as Card["location"],
    buyoutPriceCcoin: nnum(r.buyout_price_ccoin),
    nfcConfigured: bool(r.nfc_configured),
    qcStatus: (str(r.qc_status) || "pending") as Card["qcStatus"],
    ownerId: nstr(r.owner_id),
    nfcUid: str(r.nfc_uid),
    nfcShortId: str(r.nfc_short_id),
    verifyStatus: str(r.verify_status) as Card["verifyStatus"],
    lastCtr: num(r.last_ctr),
    createdAt: nstr(r.created_at) ?? undefined,
  };
}

export function mapUserRow(r: Row): User {
  return {
    id: str(r.id),
    email: str(r.email),
    displayName: str(r.display_name),
    username: nstr(r.username),
    usernameIsAuto: bool(r.username_is_auto),
    role: str(r.role) as User["role"],
    avatarUrl: nstr(r.avatar_url),
    xp: num(r.total_xp), // canonical total_xp (docs/05) — legacy users.xp ignored
    totalXp: num(r.total_xp),
    level: num(r.level),
    cumulativeSpendCcoin: num(r.cumulative_spend_ccoin),
    isAnonymous: bool(r.is_anonymous),
    flagReason: nstr(r.flag_reason),
    consentAnalyticsDetail: bool(r.consent_analytics_detail),
    consentDataMarket: bool(r.consent_data_market),
    createdAt: str(r.created_at),
  };
}

export function mapCreatorRow(r: Row): CreatorRec {
  return {
    id: str(r.id),
    userId: nstr(r.user_id),
    handle: str(r.handle),
    totalFollowersCombined: num(r.total_followers_combined),
    status: str(r.status) as CreatorRec["status"],
    bankAccount: (r.bank_account as Record<string, string> | null) ?? null,
    notes: nstr(r.notes),
    createdAt: str(r.created_at),
  };
}

export function mapBidRow(r: Row): Bid {
  return {
    id: str(r.id),
    cardId: str(r.card_id),
    bidderId: str(r.bidder_id),
    bidderName: str(r.bidder_name),
    amountCCoin: num(r.amount_ccoin),
    status: str(r.status) as Bid["status"],
    createdAt: str(r.created_at),
    outbidAt: nstr(r.outbid_at),
    cancelledAt: nstr(r.cancelled_at),
    acceptedAt: nstr(r.accepted_at),
  };
}

export function mapOrderRow(r: Row): Order {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    dropId: str(r.drop_id),
    cardIds: Array.isArray(r.card_ids) ? (r.card_ids as string[]) : [],
    cardId: nstr(r.card_id),
    totalCCoin: num(r.total_ccoin),
    totalIdr: num(r.total_idr),
    status: str(r.status) as Order["status"],
    deliveryOption: str(r.delivery_option) as Order["deliveryOption"],
    shippingFeeCcoin: nnum(r.shipping_fee_ccoin),
    escrowStatus: str(r.escrow_status) as Order["escrowStatus"],
    shippingAddress: nstr(r.shipping_address),
    trackingNumber: nstr(r.tracking_number),
    // P1-4 (audit 2026-08-24): timestamp per step timeline. Mapper `Order`
    // sudah mendukung; backend menyetel ini saat transisi status — shipped saat
    // admin input resi, delivered saat buyer/admin confirm-delivered.
    shippedAt: nstr(r.shipped_at),
    deliveredAt: nstr(r.delivered_at),
    paidAt: nstr(r.paid_at) ?? nstr(r.created_at),
    createdAt: str(r.created_at),
  };
}

export function mapShipmentRow(r: Row): Shipment {
  return {
    id: str(r.id),
    cardId: str(r.card_id),
    requesterId: str(r.requester_id),
    type: str(r.type) as Shipment["type"],
    fromLocation: str(r.from_location) as Shipment["fromLocation"],
    toDest: str(r.to_dest) as Shipment["toDest"],
    address: (r.address as Shipment["address"]) ?? null,
    feeCcoin: nnum(r.fee_ccoin),
    status: str(r.status) as Shipment["status"],
    trackingNumber: nstr(r.tracking_number),
    platformCheck: (r.platform_check as Record<string, unknown> | null) ?? null,
    createdAt: str(r.created_at),
  };
}

export function mapWalletRow(r: Row): Wallet {
  return {
    userId: str(r.user_id),
    balanceCCoin: num(r.balance_ccoin),
    totalTopupCCoin: num(r.total_topup_ccoin),
    totalSpentCCoin: num(r.total_spent_ccoin),
    holdPayoutUntil: nstr(r.hold_payout_until),
    updatedAt: nstr(r.updated_at) ?? undefined,
  };
}

export function mapWalletTxRow(r: Row): WalletTx {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    type: str(r.type),
    amountCCoin: num(r.amount_ccoin),
    balanceAfterCCoin: num(r.balance_after_ccoin),
    refType: nstr(r.ref_type),
    refId: nstr(r.ref_id),
    note: nstr(r.note),
    createdAt: str(r.created_at),
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}

export function mapBadgeRow(r: Row): BadgeDef {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    description: str(r.description),
    icon: str(r.icon ?? r.icon_url),
    iconUrl: nstr(r.icon_url) ?? nstr(r.icon),
    xp: num(r.xp_reward ?? r.xp),
    xpReward: num(r.xp_reward ?? r.xp),
    criteria: (r.criteria as Record<string, unknown> | null) ?? null,
    isActive: r.is_active == null ? true : bool(r.is_active),
  };
}

export function mapUserBadgeRow(r: Row): UserBadge {
  return {
    userId: str(r.user_id),
    badgeId: str(r.badge_id),
    earnedAt: str(r.earned_at ?? r.awarded_at),
    awardedAt: nstr(r.awarded_at) ?? undefined,
    xpRewardSnapshot: nnum(r.xp_reward_snapshot) ?? undefined,
  };
}

export function mapKycRow(r: Row): KycRecord {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    fullName: str(r.full_name),
    nik: str(r.nik),
    address: str(r.address),
    status: str(r.status) as KycRecord["status"],
    createdAt: str(r.created_at),
    updatedAt: nstr(r.updated_at) ?? undefined,
    dob: nstr(r.dob) ?? null,
    ktpUrl: nstr(r.ktp_url) ?? null,
    npwpUrl: nstr(r.npwp_url) ?? null,
    selfieUrl: nstr(r.selfie_url) ?? null,
  };
}

export function mapOwnershipRow(r: Row): {
  id: string;
  cardId: string;
  ownerId: string;
  acquiredVia: "primary" | "secondary_buyout" | "secondary_bid" | "gift";
  orderId: string | null;
  bidId: string | null;
  transferredAt: string;
} {
  return {
    id: str(r.id),
    cardId: str(r.card_id),
    ownerId: str(r.owner_id),
    acquiredVia: str(r.acquired_via) as "primary" | "secondary_buyout" | "secondary_bid" | "gift",
    orderId: nstr(r.order_id),
    bidId: nstr(r.bid_id),
    transferredAt: str(r.transferred_at),
  };
}

// ── Pagination helper (query param limit/offset, clamp) ────────────────────
export interface PageParams {
  limit: number;
  offset: number;
}
export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 60;

export function parsePageParams(query: Record<string, string>): PageParams {
  const limit = Number.parseInt(query.limit ?? "", 10);
  const offset = Number.parseInt(query.offset ?? "", 10);
  return {
    limit: Number.isFinite(limit) ? Math.min(MAX_PAGE_LIMIT, Math.max(1, limit)) : DEFAULT_PAGE_LIMIT,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
  };
}

export function pageMeta(total: number, p: PageParams): PageMeta {
  return { total, limit: p.limit, offset: p.offset, hasMore: p.offset + p.limit < total };
}

export function slicePage<T>(items: T[], p: PageParams): T[] {
  return items.slice(p.offset, p.offset + p.limit);
}
