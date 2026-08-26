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

import type { Badge, Bid, Card, Order, Shipment, UserBadge, Wallet, WalletTransaction } from "@c-verse/shared";

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
  // Fields ditambahkan route /api/drops GET (lihat apps/api/src/routes/drops.ts:52-88)
  remainingUnits?: number;
  idrPrice?: number;
  idrUnsigned?: number;
  idrSigned?: number;
  creatorHandle?: string | null;
  creatorUsername?: string | null;
  stats?: { total: number; sold: number; available: number };
  cardsPreview?: Card[];
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
// GET /api/nfc/cards/:cardId (apps/api/src/routes/nfc.ts:188) — info lengkap:
//   card ringkas + drop ringkas + owner + bids aktif + ownership history.
// Owner ditampilkan anonim jika user.isAnonymous || user.flagReason (route:204).
export interface ApiCardOwnerRef {
  id: string;
  displayName: string;
  username?: string | null;
  isAnonymous?: boolean;
}

export interface ApiCardOwnershipRow {
  id: string;
  cardId: string;
  ownerId: string;
  acquiredVia: string;
  orderId: string | null;
  bidId: string | null;
  transferredAt: string;
  ownerName: string;
}

export interface ApiCardDetailResponse {
  card: Card;
  drop: ApiDrop | null;
  creator: { id: string; displayName: string; username?: string | null } | null;
  owner: ApiCardOwnerRef | null;
  activeBid: Bid | null;
  bids: Bid[];
  ownershipHistory: ApiCardOwnershipRow[];
}

// GET /api/nfc/cards/:cardId/3d — data untuk viewer 3D + VerifiedBadge.
export interface ApiCard3dResponse {
  card: Card & { totalUnits?: number | null };
  drop: ApiDrop | null;
  seriesLink: string | null;
  creator: { id: string; name: string; link: string } | null;
  owner: { id: string; name: string; link: string } | null;
  releaseDate: string | null;
  verifiedBadge: string | null;
  hint: string | null;
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
// GET /api/browse — kartu ber-pemilik dengan buyout aktif + bid tertinggi.
// `activeBid` adalah Bid lengkap dari listBids(active); `canBid` flag server.
export interface ApiBrowseEntry {
  card: Card;
  drop: {
    id: string;
    title: string;
    series: string;
    artworkUrl: string;
    creatorName: string;
    isSeed: boolean;
  } | null;
  owner: { id: string; displayName: string } | null;
  buyoutIdr: number | null;
  activeBid: Bid | null;
  canBid: boolean;
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
// GET /api/public/u/:username — profile publik kolektor (docs 11-anon + 02-pages).
// Hidden profile = `{ user, hidden: true }` tanpa cards/badges.
export interface ApiPublicProfileCard extends Card {
  drop: { id: string; title: string; series: string } | null;
}

export interface ApiPublicProfileResponse {
  hidden?: boolean;
  user: ApiUser & {
    level?: number;
    tier?: string;
    levelProgressPct?: number;
    rank?: number;
  };
  cards?: ApiPublicProfileCard[];
  badges?: UserBadge[];
  drops?: ApiDrop[];
  collection?: Card[];
  totalCards?: number;
  stats?: { totalCards?: number };
}

export interface ApiCreatorPublicResponse {
  creator: {
    id: string;
    displayName: string;
    username: string | null;
    handle: string | null;
    totalFollowersCombined: number | null;
    xp?: number;
    drops?: ApiDrop[];
    stats?: {
      totalViews?: number;
      uniqueViewers?: number;
      topReferrer?: { domain: string; count: number } | null;
    };
  };
}

// ── Gamification ──────────────────────────────────────────────────────────
// GET /api/gamification/leaderboard — derived from listTopUsersByXp,
// field tambahan: username, totalCards (lihat apps/api/src/routes/gamification.ts:16-28).
export interface ApiLeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  username: string | null;
  level: number;
  tier: string;
  totalCards: number;
}

export interface ApiLeaderboardResponse {
  leaderboard: ApiLeaderboardEntry[];
}

// GET /api/gamification/badges → list def Badge (shared Badge type reusable).
export interface ApiBadgesResponse {
  badges: Badge[];
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
