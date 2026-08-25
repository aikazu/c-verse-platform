// apps/web/src/lib/api-types.ts
//
// Response shapes untuk endpoint /api/* yang dipakai lib/api.ts.
// Domain types (Drop, Card, Order, Wallet, Bid, Shipment, dll) bersumber
// kanonikal dari @c-verse/shared; tipe spesifik-route di sini cuma membungkus
// shape response HTTP (object keys, paging meta, dll).
//
// Prinsip: server adalah source of truth (apps/api/src/lib/store.ts). Tipe di
// sini adalah mirror statis — kalau server menambah field, tipe ini ikut
// melebar secara opt-in (partial / unknown-friendly), bukan ditiru ulang.

import type { Badge, Bid, Card, LeaderboardEntry, Order, Shipment, UserBadge, Wallet, WalletTransaction } from "@c-verse/shared";

import type { PagedMeta } from "./api";

// ── Domain response shape (sesuai runtime API) ────────────────────────────
// Shared `Drop`/`Card` di @c-verse/shared pakai `priceCCoin` (double C) untuk
// legacy compat, tapi API mapper (apps/api/src/lib/reads.ts) mengembalikan
// `priceCcoin` (single C) sebagai shape JSON aktual yang diakses halaman web.
// Pakai alias lokal ini agar type web cocok dengan response runtime — server
// adalah source of truth.
export interface ApiDrop {
  id: string;
  title: string;
  series: string;
  narrative: string;
  artworkUrl: string;
  artwork3dUrl?: string | null;
  totalUnits: number;
  signedCount: number;
  unsignedCount: number;
  priceCcoin: number;
  priceUnsignedCCoin: number;
  priceSignedCCoin: number;
  status: string;
  dropAt: string | null;
  dropStartAt?: string | null;
  dropEndAt?: string | null;
  raffleEndAt?: string | null;
  drawnAt?: string | null;
  creatorId: string;
  creatorName: string;
  soldCount: number;
  createdAt: string;
  createdBy?: string | null;
  isSeed: boolean;
}

// ── Auth ───────────────────────────────────────────────────────────────────
export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  username?: string | null;
  usernameIsAuto?: boolean;
  role: "user" | "creator" | "admin";
  avatarUrl?: string | null;
  xp?: number;
  totalXp?: number;
  level?: number;
  cumulativeSpendCcoin?: number;
  isAnonymous?: boolean;
  flagReason?: string | null;
  consentAnalyticsDetail?: boolean;
  consentDataMarket?: boolean;
  createdAt?: string;
}

// ── Drops ──────────────────────────────────────────────────────────────────
export interface ApiDropsResponse extends PagedMeta {
  drops: ApiDrop[];
}

export type ApiDropDetailResponse = ApiDrop & {
  cards?: Card[];
};

// ── Wallet ─────────────────────────────────────────────────────────────────
export interface ApiWalletResponse {
  wallet: Wallet;
  transactions: WalletTransaction[];
  rate: number; // default 10_000 (IDR per C-Coin)
  topupCapNoKyc: number;
  minPayout: number;
  payoutHeld: boolean;
  payoutHoldUntil: string | null;
  disclosureOpsiA: string;
}

// ── Payments (Midtrans) ────────────────────────────────────────────────────
export interface ApiTopupResponse {
  orderId: string;
  provider: string;
  amountCcoin: number;
  amountIdr: number;
  snapToken?: string | null;
  redirectUrl?: string | null;
  expiresInMinutes?: number;
}

export interface ApiPayoutResponse {
  payout: {
    id: string;
    userId: string;
    amountCcoin: number;
    status: string;
    scheduledFor?: string;
    createdAt: string;
  };
}

// ── Orders (primary) ───────────────────────────────────────────────────────
export interface ApiOrdersResponse {
  orders: Order[];
}

export interface ApiOrderDetailResponse {
  order: Order;
  drop?: ApiDrop;
  cards: Card[];
  shipments?: Shipment[];
}

export interface ApiCheckoutResponse {
  order: Order;
  cards: Card[];
  wallet: Wallet;
}

// ── NFC / Cards ────────────────────────────────────────────────────────────
export interface ApiCardOwnershipRow {
  ownerId: string | null;
  ownerName: string | null;
  ownerHandle?: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  flagReason: string | null;
  acquiredAt: string;
  acquiredVia: "primary" | "secondary_buyout" | "secondary_bid" | "gift" | string;
}

export interface ApiCardDetailResponse {
  card: Card;
  drop: ApiDrop;
  ownershipHistory?: ApiCardOwnershipRow[];
}

export interface ApiCard3dResponse {
  card: Card;
  drop: ApiDrop;
}

export interface ApiVerifyShortIdResponse {
  cardId: string;
  shortId: string;
  verifyStatus: "verified" | "registered" | "tamper_detected" | "unknown";
  tamperFlagged: boolean;
}

export interface ApiVerifyNfcResponse {
  cardId: string;
  uid: string;
  counter: number;
  verifyStatus: "verified" | "registered" | "tamper_detected" | "unknown";
  tamperFlagged: boolean;
}

// ── Marketplace (buyout on card) ───────────────────────────────────────────
// GET /api/listings response shape (apps/api/src/routes/marketplace.ts:42-68)
// — setiap entry adalah gabungan: kartu + drop ringkas + seller + harga.
export interface ApiMarketplaceEntry {
  kind: "buyout";
  card: Card;
  drop: {
    id: string;
    title: string;
    series: string;
    artworkUrl: string;
    creatorName: string;
    isSeed: boolean;
  } | null;
  seller: { id: string; displayName: string } | null;
  buyoutPriceCcoin: number | null;
  idrPrice: number;
}

export interface ApiListingsResponse extends PagedMeta {
  marketplace: ApiMarketplaceEntry[];
  // Legacy aliases — route also returns `cards`/`listings` echoing the same
  // data (page consumer can read whichever is present).
  cards?: ApiMarketplaceEntry[];
  listings?: ApiMarketplaceEntry[];
}

// Back-compat alias — `marketplaceCards()` uses the same response shape as `listings()`.
export type ApiMarketplaceResponse = ApiListingsResponse;

export interface ApiBuyoutResponse {
  ok: boolean;
  card: Card;
}

export interface ApiPatchBuyoutResponse {
  card: Card;
}

// ── Browse ─────────────────────────────────────────────────────────────────
export interface ApiBrowseEntry {
  card: Card;
  drop: ApiDrop;
  buyoutPriceCcoin: number | null;
  highestBidCcoin?: number | null;
  activeBidsCount?: number;
}

export interface ApiBrowseResponse extends PagedMeta {
  cards: ApiBrowseEntry[];
  results?: ApiBrowseEntry[];
}

// ── Bids ───────────────────────────────────────────────────────────────────
export interface ApiBidResponse {
  bid: Bid;
  activeBid?: Bid;
  listing?: never; // legacy indirection removed
}

export interface ApiCancelBidResponse {
  bid: Bid;
}

export interface ApiAcceptBidResponse {
  ok: boolean;
  order?: Order;
  shipment?: Shipment;
  card?: Card;
}

// ── Profile ────────────────────────────────────────────────────────────────
export interface ApiProfileEnrichedCard extends Card {
  drop: { id: string; title: string; series: string; artworkUrl: string } | null;
  activeBid: Bid | null;
}

export interface ApiProfileResponse {
  user: ApiUser & {
    level?: number;
    tier?: string;
    levelProgressPct?: number;
    levelProgressLabel?: string;
  };
  cards: ApiProfileEnrichedCard[];
  wallet?: Wallet & { balanceIdrEquiv: number };
  orders?: Order[];
  shipments?: Shipment[];
  bids?: Bid[];
  listings?: unknown[];
  badges?: unknown[];
  kyc?: { status: "pending" | "approved" | "rejected" | "unsubmitted" };
  stats?: {
    totalCards: number;
    vaultCards: number;
    withOwnerCards: number;
    buyoutListed: number;
  };
}

export interface ApiMyCardsResponse {
  cards: Card[];
}

export interface ApiPatchProfileResponse {
  user: ApiUser;
}

// ── Public profile / creator ──────────────────────────────────────────────
export interface ApiPublicProfileResponse {
  user: ApiUser;
  drops?: ApiDrop[];
  collection?: Card[];
  totalCards?: number;
}

export interface ApiCreatorPublicResponse {
  creator: {
    id: string;
    handle: string;
    displayName?: string | null;
    bannerUrl?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    totalFollowersCombined: number;
    drops?: ApiDrop[];
    isActive: boolean;
    stats?: Record<string, number>;
  };
}

export interface ApiApplyCreatorResponse {
  creator: {
    handle: string;
    status: string;
    message: string;
  };
}

// ── Gamification ──────────────────────────────────────────────────────────
export interface ApiLeaderboardResponse {
  leaderboard: LeaderboardEntry[];
}

export interface ApiBadgesResponse {
  badges: (UserBadge & { badge: Badge })[];
}

// ── KYC ────────────────────────────────────────────────────────────────────
export interface ApiKycResponse {
  kyc: {
    id?: string;
    userId?: string;
    fullName?: string;
    nik?: string | null;
    address?: string | null;
    status: "pending" | "approved" | "rejected" | "unsubmitted";
    createdAt?: string;
    updatedAt?: string;
  };
}

// ── Carrier untuk typed error codes dari server ──────────────────────────
export interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
}
