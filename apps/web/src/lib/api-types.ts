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
  // Fields ditambahkan route /api/drops GET (lihat apps/api/src/modules/drops/routes.ts)
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
  // Entry viewer yang login (unique 1/drop) — null saat anonim/belum ikut.
  // UI: state "sudah ikut" menggantikan tombol entry.
  myEntry?: { pool: string; holdCcoin: number; status: string } | null;
  // P0-1 (audit 2026-08-24): jumlah entry hidup per pool (reguler/premium)
  // ditambahkan saat endpoint tahu jumlah — saat ini route /api/drops/:id belum
  // mengembalikan field ini; dihitung dari endpoint /api/drops/:id/entry-counts
  // bila ada. Untuk sekarang fallback ke undefined dan UI sembunyikan count.
  entryCounts?: { regular: number; premium: number; both: number } | null;
};

// ── Wallet ─────────────────────────────────────────────────────────────────
// Dual-token (docs/07): runtime /api/wallet menambah saldo Gems + breakdown
// kesiapan cair di atas shared `Wallet` (apps/api/src/lib/store.ts WalletGems).
// gemsMatured + gemsLocked = balanceGems (lot ≤ GEMS_LOCK_HOURS masih dikunci).
export interface ApiWalletGems extends Wallet {
  balanceGems: number;
  gemsMatured: number;
  gemsLocked: number;
}

// Baris gem_transactions (append-only): amount positif = kredit (royalti/
// settlement/dukungan), negatif = debit (konversi/payout).
export interface GemTransaction {
  amount: number;
  balanceAfterGems: number;
  refType: string | null;
  createdAt: string;
}

export interface ApiWalletResponse {
  wallet: ApiWalletGems;
  transactions: WalletTransaction[];
  // Ledger C-Gems (dual-token docs/07) — label via walletTxTypeLabel(refType).
  gemTxs: GemTransaction[];
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

// Vault-only checkout (founder 2026-08-28): every NEW order settles straight
// to the vault — `deliveryOption` is always "vault" and `escrowStatus` is
// always "released". The wider shared `Order` union is kept untouched for
// legacy shipping orders already stored in the DB.
export interface ApiCheckoutResponse {
  order: Order & { deliveryOption?: "vault"; escrowStatus?: "released" };
  cards: Card[];
  wallet: Wallet;
}

// ── NFC / Cards ────────────────────────────────────────────────────────────
// Proyeksi kartu publik (batch-1 privacy, apps/api/src/modules/nfc/routes.ts):
// server membuang ownerId (UUID — deanonymisasi via korelasi), nfcUid (input
// diversifikasi kunci CMAC), dan dropId dari payload kartu; personalisasi
// viewer lewat flag isOwner/isMine, bukan id.
export type ApiPublicCard = Omit<Card, "dropId" | "ownerId" | "nfcUid">;

// GET /api/nfc/cards/:cardId — info lengkap: card publik + drop ringkas +
// owner + bids aktif + ownership history. Owner anonim/flagged dimasking
// server jadi "Anonim" (publicOwner di nfc/routes.ts) — tanpa id.
export interface ApiCardOwnerRef {
  displayName: string;
  username: string | null;
  isOwner?: boolean;
}

// Bid publik (toPublicBid di apps/api/src/lib/reads.ts): bidderId dibuang,
// isMine hanya ada saat ada viewer. canCancelAt (founder 2026-09-01) = created_at
// + 24h cooldown (ISO UTC) — hanya untuk bid milik viewer; absen = bebas cancel.
export type ApiPublicBid = Omit<Bid, "bidderId"> & { isMine?: boolean; canCancelAt?: string };

export interface ApiCardOwnershipRow {
  id: string;
  cardId: string;
  acquiredVia: string;
  orderId: string | null;
  bidId: string | null;
  transferredAt: string;
  ownerName: string;
}

export interface ApiCardDetailResponse {
  card: ApiPublicCard;
  drop: ApiDrop | null;
  creator: { id: string; displayName: string; username?: string | null } | null;
  owner: ApiCardOwnerRef | null;
  activeBid: ApiPublicBid | null;
  bids: ApiPublicBid[];
  ownershipHistory: ApiCardOwnershipRow[];
}

// GET /api/nfc/cards/:cardId/3d — data untuk viewer 3D + VerifiedBadge.
// Card di sini lebih ramping dari endpoint detail (tanpa status/location/
// buyoutPriceCcoin) + totalUnits; owner = {name, link} tanpa id.
export interface ApiCard3dCard {
  id: string;
  unitNumber: number;
  totalUnits?: number | null;
  variant: Card["variant"];
  nfcShortId: string;
  verifyStatus: Card["verifyStatus"];
}

export interface ApiCard3dResponse {
  card: ApiCard3dCard;
  drop: ApiDrop | null;
  seriesLink: string | null;
  creator: { id: string; name: string; link: string } | null;
  owner: { name: string; link: string } | null;
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
// GET /api/listings response shape (apps/api/src/modules/marketplace/routes.ts:42-68)
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

// ── Bids ───────────────────────────────────────────────────────────────────
export interface ApiBidResponse {
  bid: Bid;
  activeBid?: Bid;
  listing?: never; // legacy indirection removed
}

export interface ApiCancelBidResponse {
  bid: Bid;
}

// Vault-only accept (founder 2026-08-28): the accepted sale settles straight
// to the vault — any returned order is always "vault"/"released" (legacy
// shipping unions kept for data already stored).
export interface ApiAcceptBidResponse {
  ok: boolean;
  order?: Order & { deliveryOption?: "vault"; escrowStatus?: "released" };
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
  };
  // GET /api/creators/:id returns drops/stats as siblings of `creator`.
  drops?: ApiDrop[];
  stats?: {
    totalViews?: number;
    uniqueViewers?: number;
    topReferrer?: { domain: string; count: number } | null;
  };
}

// ── Gamification ──────────────────────────────────────────────────────────
// GET /api/gamification/leaderboard — single entry shape across all board
// types (xp/cards/badges/creator). `LeaderboardEntry` is the canonical flat
// row from @c-verse/shared (rank/userId/displayName/username/avatarUrl/
// totalXp/level/tier/score/reachedAt). Server is source of truth for `score`
// semantics per board type; client must NOT derive `score` locally.
export type { LeaderboardEntry };

export interface ApiLeaderboardResponse {
  leaderboard: LeaderboardEntry[];
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
    dob?: string | null;
    ktpUrl?: string | null;
    npwpUrl?: string | null;
    selfieUrl?: string | null;
  };
}

// ── Carrier untuk typed error codes dari server ──────────────────────────
export interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
}
