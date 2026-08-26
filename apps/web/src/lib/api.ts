import type { Drop, Order, Shipment, Wallet } from "@c-verse/shared";
import type {
  ApiAcceptBidResponse,
  ApiBadgesResponse,
  ApiBidResponse,
  ApiBrowseResponse,
  ApiBuyoutResponse,
  ApiCancelBidResponse,
  ApiCard3dResponse,
  ApiCardDetailResponse,
  ApiCheckoutResponse,
  ApiCreatorPublicResponse,
  ApiDropDetailResponse,
  ApiDropsResponse,
  ApiKycResponse,
  ApiLeaderboardResponse,
  ApiListingsResponse,
  ApiMarketplaceResponse,
  ApiMyCardsResponse,
  ApiOrderDetailResponse,
  ApiOrdersResponse,
  ApiPatchBuyoutResponse,
  ApiPatchProfileResponse,
  ApiPayoutResponse,
  ApiProfileResponse,
  ApiPublicProfileResponse,
  ApiTopupResponse,
  ApiUser,
  ApiVerifyNfcResponse,
  ApiVerifyShortIdResponse,
  ApiWalletResponse,
} from "./api-types";

const API_BASE = "";

// metadata pagination dari endpoint list server-side (lihat apps/api reads.ts PageMeta)
export interface PagedMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** API error carrying HTTP status + machine-readable code (e.g. KYC_TOPUP_CAP). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

// Supabase Auth: access token di-push dari AuthProvider (session di-manage supabase-js).
let sessionToken: string | null = null;

export function setApiToken(token: string | null) {
  sessionToken = token;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${API_BASE}/api${path}`, { ...opts, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error || data.message || `HTTP ${res.status}`, res.status, data.code);
  return data as T;
}

export const api = {
  // auth (Supabase Auth dipakai di lib/auth.tsx; endpoint password & demo-login dihapus per docs/10)
  me: () => req<ApiUser>("/auth/me"),

  // drops
  drops: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<ApiDropsResponse>(`/drops${qs}`);
  },
  drop: (id: string) => req<ApiDropDetailResponse>(`/drops/${id}`),
  // P0-1 (audit 2026-08-24): raffle entry — Phase-1 Flow 1 docs/03_flows.
  // Backend: POST /api/drops/:id/entry { pool: "regular" | "premium" | "both" }
  // → RPC rpcDropEntry. Hold C-Coin (escrow) sampai draw; release saat kalah.
  entryRaffle: (dropId: string, pool: "regular" | "premium" | "both") =>
    req<{ entry: { dropId: string; userId: string; pool: "regular" | "premium" | "both"; createdAt: string } }>(`/drops/${dropId}/entry`, {
      method: "POST",
      body: JSON.stringify({ pool }),
    }),
  // Body validated server-side by createDropSchema (docs/13). Payload type is
  // intentionally broad here to avoid duplicating schema in two places — server
  // is the source of truth.
  createDrop: (body: Record<string, unknown>) => req<{ drop: Drop }>("/drops", { method: "POST", body: JSON.stringify(body) }),
  publishDrop: (id: string, status: string) =>
    req<{ drop: Drop }>(`/drops/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),

  // wallet
  wallet: () => req<ApiWalletResponse>("/wallet"),

  // payments (Midtrans): topup returns payment instruction, payout creates weekly-batch request
  topup: (amountCcoin: number) => req<ApiTopupResponse>("/payments/topup", { method: "POST", body: JSON.stringify({ amountCcoin }) }),
  payout: (amountCcoin: number) => req<ApiPayoutResponse>("/payments/payout", { method: "POST", body: JSON.stringify({ amountCcoin }) }),

  // orders (primary)
  orders: () => req<ApiOrdersResponse>("/orders"),
  order: (id: string) => req<ApiOrderDetailResponse>(`/orders/${id}`),
  // Body validated server-side by checkoutSchema (docs/13). Server source of truth.
  checkout: (body: Record<string, unknown>) => req<ApiCheckoutResponse>("/orders/checkout", { method: "POST", body: JSON.stringify(body) }),
  confirmDelivered: (id: string) => req<{ order: Order }>(`/orders/${id}/confirm-delivered`, { method: "POST" }),
  openDispute: (orderId: string, reason: string) =>
    req<{ order: Order }>(`/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) }),
  // Body validated server-side by vaultShipoutSchema. Server source of truth.
  vaultShipout: (cardId: string, address: string, feeCcoin: number) =>
    req<{ ok: boolean; shipment: Shipment; wallet: Wallet }>("/orders/vault-shipout", {
      method: "POST",
      body: JSON.stringify({ cardId, address, feeCcoin }),
    }),

  // nfc / cards (merged verify per 02-pages: card info + 3D separate)
  card: (cardId: string) => req<ApiCardDetailResponse>(`/nfc/cards/${encodeURIComponent(cardId)}`),
  card3d: (cardId: string) => req<ApiCard3dResponse>(`/nfc/cards/${encodeURIComponent(cardId)}/3d`),
  verifyShortId: (shortId: string) => req<ApiVerifyShortIdResponse>(`/nfc/verify/${encodeURIComponent(shortId)}`),
  verifyNfc: (body: { uid: string; counter?: string; cmac?: string; shortId?: string }) =>
    req<ApiVerifyNfcResponse>("/nfc/verify-nfc", { method: "POST", body: JSON.stringify(body) }),

  // marketplace (buyout on card) — F-02 FINAL: hanya buyout-on-card, tanpa listing indirection
  marketplaceCards: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<ApiMarketplaceResponse>(`/listings${qs}`);
  },
  listings: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<ApiListingsResponse>(`/listings${qs}`);
  },
  // Body validated server-side by setBuyoutSchema. Server source of truth.
  setBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<ApiPatchBuyoutResponse>("/listings", { method: "POST", body: JSON.stringify({ cardId, buyoutPriceCcoin }) }),
  buyout: (cardId: string, destination: "buyer_address" | "platform_vault", shippingAddress?: string) =>
    req<ApiBuyoutResponse>(`/listings/buyout`, {
      method: "POST",
      body: JSON.stringify({ cardId, destination, ...(shippingAddress ? { shippingAddress } : {}) }),
    }),
  patchBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<ApiPatchBuyoutResponse>(`/listings/cards/${cardId}/buyout`, { method: "PATCH", body: JSON.stringify({ buyoutPriceCcoin }) }),

  // browse
  browse: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<ApiBrowseResponse>(`/browse${qs}`);
  },

  // bids (direct on card — F-02 FINAL: tidak ada listing indirection; bid
  // selalu lewat cardId). API menerima alias amountCCoin untuk back-compat
  // (docs/03 Flow 7); server tidak pernah pakai listingId.
  placeBid: (cardId: string, amountCcoin: number) =>
    req<ApiBidResponse>(`/bids`, {
      method: "POST",
      body: JSON.stringify({ cardId, amountCCoin: amountCcoin, amountCcoin: amountCcoin }),
    }),
  cancelBid: (bidId: string) => req<ApiCancelBidResponse>(`/bids/${bidId}/cancel`, { method: "POST" }),
  acceptBidOnCard: (cardId: string, destination?: "buyer_address" | "platform_vault", shippingAddress?: string) =>
    req<ApiAcceptBidResponse>(`/bids/cards/${cardId}/accept`, {
      method: "POST",
      body: JSON.stringify({ destination, ...(shippingAddress ? { shippingAddress } : {}) }),
    }),

  // profile
  profile: () => req<ApiProfileResponse>("/profile"),
  myCards: () => req<ApiMyCardsResponse>("/profile/cards"),
  patchPrivacy: (isAnonymous: boolean) =>
    req<{ user: ApiUser }>("/profile/privacy", { method: "PATCH", body: JSON.stringify({ isAnonymous }) }),
  patchConsent: (body: { consentAnalyticsDetail?: boolean; consentDataMarket?: boolean }) =>
    req<{ user: ApiUser }>("/profile/consent", { method: "PATCH", body: JSON.stringify(body) }),
  // Body validated server-side by `profileSchema` + `displayNameSchema` (L1 audit).
  patchProfile: (body: Record<string, unknown>) =>
    req<ApiPatchProfileResponse>("/profile", { method: "PATCH", body: JSON.stringify(body) }),

  // shipments — P0-6 (audit 2026-08-24): seller → vault flow.
  shipments: () => req<{ shipments: Shipment[] }>("/shipments"),
  sellerShipToVault: (cardId: string, address: string, trackingNumber?: string) =>
    req<{ ok: boolean; shipment: Shipment }>("/shipments/seller-to-vault", {
      method: "POST",
      body: JSON.stringify({ cardId, address, ...(trackingNumber ? { trackingNumber } : {}) }),
    }),

  // public profile / creator
  publicProfile: (username: string) => req<ApiPublicProfileResponse>(`/public/u/${encodeURIComponent(username)}`),
  creatorPublic: (idOrHandle: string) => req<ApiCreatorPublicResponse>(`/creators/${encodeURIComponent(idOrHandle)}`),
  // P0-4 (audit 2026-08-24): payout history + drop list untuk kreator.
  myPayouts: () =>
    req<{
      payouts: Array<{
        id: string;
        batch_id: string | null;
        type: "creator_share" | "seller_proceeds" | "royalty";
        ccoin_amount: number;
        idr_amount: number;
        withholding_tax: unknown;
        status: string;
        requested_at: string;
      }>;
    }>(`/creators/me/payouts`),
  myDrops: () => req<{ drops: Drop[] }>(`/creators/me/drops`),
  // applyCreator dihapus: docs/03_flows.md Flow 11 — kreator TIDAK self-register;
  // provisioning lewat admin (POST /api/admin/users/provision).

  // gamification
  leaderboard: (limit = 20) => req<ApiLeaderboardResponse>(`/gamification/leaderboard?limit=${limit}`),
  badges: () => req<ApiBadgesResponse>("/gamification/badges"),

  // kyc
  // Body validated server-side by kycSchema. Server source of truth.
  kyc: () => req<ApiKycResponse>("/kyc"),
  submitKyc: (body: Record<string, unknown>) => req<ApiKycResponse>("/kyc", { method: "POST", body: JSON.stringify(body) }),

  // notifications — P0-3 inbox (audit 2026-08-24).
  notifications: (limit = 30) =>
    req<{
      notifications: Array<{
        id: string;
        templateKey: string;
        payload: Record<string, unknown> | null;
        createdAt: string;
        readAt: string | null;
      }>;
    }>(`/notifications?limit=${limit}`),
  unreadCount: () => req<{ unread: number }>("/notifications/unread-count"),
  markRead: (id: string) => req<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }),
  markAllRead: () => req<{ ok: boolean }>("/notifications/read-all", { method: "PATCH" }),
};

export function ccoinToIdr(c: number, rate = 10000) {
  return c * rate;
}
export function formatIdr(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
