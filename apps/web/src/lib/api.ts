import type { Drop, LeaderboardType, Order, Shipment, Wallet } from "@c-verse/shared";
import type {
  ApiAcceptBidResponse,
  ApiBadgesResponse,
  ApiBidResponse,
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

// ── Drop detail extensions (B2) ────────────────────────────────────────────
// Winner row dari GET /api/drops/:id — hanya ada saat drop sudah diundi
// (drawnAt / status sold_out|closed). `displayName` sudah dimasking
// server-side untuk user privasi ("Anonim").
export interface ApiDropWinner {
  unitNumber: number;
  variant: "signed" | "unsigned";
  displayName: string;
}

// Baris kartu dari GET /api/drops/:id/cards — seluruh unit drop, signed dulu
// lalu unitNumber asc (urutan server).
export interface ApiDropCardRow {
  id: string;
  unitNumber: number;
  variant: "signed" | "unsigned";
  status: string;
  isOwned: boolean;
}

export type ApiDropDetailWithWinners = ApiDropDetailResponse & { winners?: ApiDropWinner[] };

export const api = {
  // auth (Supabase Auth dipakai di lib/auth.tsx; endpoint password & demo-login in-memory dihapus per docs/10)
  me: () => req<ApiUser>("/auth/me"),

  // DEV ONLY — one-click login akun seed (masa demo lokal); 404 kecuali ENABLE_DEMO_LOGIN aktif di API
  demoLogin: (email: string) =>
    req<{ email: string; tokenHash: string }>("/auth/demo-login", { method: "POST", body: JSON.stringify({ email }) }),

  // drops
  drops: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<ApiDropsResponse>(`/drops${qs}`);
  },
  drop: (id: string) => req<ApiDropDetailWithWinners>(`/drops/${id}`),
  // B2: seluruh unit sebuah drop (signed dulu, unitNumber asc — urutan server).
  // Dipakai grid per-kartu di halaman drop.
  dropCards: (dropId: string) => req<{ cards: ApiDropCardRow[] }>(`/drops/${dropId}/cards`),
  // P0-1 (audit 2026-08-24): raffle entry — Phase-1 Flow 1 docs/03_flows.
  // Backend: POST /api/drops/:id/entry { pool: "regular" | "premium" | "both" }
  // → RPC rpcDropEntry. Hold C-Coin (escrow) sampai draw; release saat kalah.
  entryRaffle: (dropId: string, pool: "regular" | "premium" | "both") =>
    req<{ entry: { dropId: string; userId: string; pool: "regular" | "premium" | "both"; createdAt: string } }>(`/drops/${dropId}/entry`, {
      method: "POST",
      body: JSON.stringify({ pool }),
    }),
  // Drop create/status = admin-only (founder 2026-08-29, docs 03 ADM-02) —
  // hanya apps/admin yang memanggil; dashboard kreator read-only analytics.

  // wallet
  wallet: () => req<ApiWalletResponse>("/wallet"),
  // Creator support (A2): spend C-Coin — server returns the fresh balance.
  supportCreator: (creatorId: string, amountCcoin: number) =>
    req<{ transactionId: string; balanceCcoin: number }>("/wallet/support", {
      method: "POST",
      body: JSON.stringify({ creatorId, amountCcoin }),
    }),

  // payments (Midtrans): topup returns payment instruction, payout creates weekly-batch request
  topup: (amountCcoin: number) => req<ApiTopupResponse>("/payments/topup", { method: "POST", body: JSON.stringify({ amountCcoin }) }),
  payout: (amountCcoin: number) => req<ApiPayoutResponse>("/payments/payout", { method: "POST", body: JSON.stringify({ amountCcoin }) }),

  // orders (primary)
  orders: () => req<ApiOrdersResponse>("/orders"),
  order: (id: string) => req<ApiOrderDetailResponse>(`/orders/${id}`),
  // Vault-only checkout (founder 2026-08-28): body is `{ dropId, pool }` — no
  // delivery option / address / shipping fee at purchase time. The physical
  // card settles straight to the vault; shipping happens later via
  // POST /orders/vault-shipout (see vaultShipout below).
  // `pool` selects the card pool: "regular" (unsigned) or "premium" (signed
  // units, priced priceSignedCCoin by the checkout RPC). Omitted → "regular"
  // (checkoutSchema default). Server source of truth.
  checkout: (dropId: string, pool: "regular" | "premium" = "regular") =>
    req<ApiCheckoutResponse>("/orders/checkout", { method: "POST", body: JSON.stringify({ dropId, pool }) }),
  openDispute: (orderId: string, reason: string) =>
    req<{ order: Order }>(`/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) }),
  // Body validated server-side by vaultShipoutSchema. Server source of truth.
  // Fee is NOT client input — the vault_shipout RPC derives it from the
  // server-side constant SHIPMENT_FEE_CCOIN (audit 2026-08-31).
  vaultShipout: (cardId: string, address: string) =>
    req<{ ok: boolean; shipment: Shipment; wallet: Wallet }>("/orders/vault-shipout", {
      method: "POST",
      body: JSON.stringify({ cardId, address }),
    }),

  // nfc / cards (merged verify per 02-pages: card info + 3D separate)
  card: (cardId: string) => req<ApiCardDetailResponse>(`/nfc/cards/${encodeURIComponent(cardId)}`),
  // iOS SUN tap appends ?uid=&ctr=&c=&t= to the NDEF URL — forwarding them lets
  // the 3d endpoint run CMAC verification instead of capping at QR-grade
  // "registered". Values are opaque pass-through from the tag's URL.
  card3d: (cardId: string, tap?: { uid?: string; ctr?: string; cmac?: string; t?: string }) => {
    const params = new URLSearchParams();
    if (tap?.uid) params.set("uid", tap.uid);
    if (tap?.ctr) params.set("ctr", tap.ctr);
    if (tap?.cmac) params.set("cmac", tap.cmac);
    if (tap?.t) params.set("t", tap.t);
    const qs = params.toString();
    return req<ApiCard3dResponse>(`/nfc/cards/${encodeURIComponent(cardId)}/3d${qs ? `?${qs}` : ""}`);
  },
  verifyShortId: (shortId: string) => req<ApiVerifyShortIdResponse>(`/nfc/verify/${encodeURIComponent(shortId)}`),
  verifyNfc: (body: { uid: string; counter?: string; cmac?: string; shortId?: string; t?: string }) =>
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

  // bids (direct on card — F-02 FINAL: tidak ada listing indirection; bid
  // selalu lewat cardId). API menerima alias amountCCoin untuk back-compat
  // (docs/03 Flow 7); server tidak pernah pakai listingId.
  placeBid: (cardId: string, amountCcoin: number) =>
    req<ApiBidResponse>(`/bids`, {
      method: "POST",
      body: JSON.stringify({ cardId, amountCCoin: amountCcoin, amountCcoin: amountCcoin }),
    }),
  cancelBid: (bidId: string) => req<ApiCancelBidResponse>(`/bids/${bidId}/cancel`, { method: "POST" }),
  // Vault-only accept (founder 2026-08-28): no destination/address — the card
  // settles straight to the vault; the buyer requests physical shipping later
  // via vault-shipout. Route validates acceptBidSchema = z.object({}).strict()
  // via zValidator("json") → the POST must carry an empty JSON body.
  acceptBidOnCard: (cardId: string) =>
    req<ApiAcceptBidResponse>(`/bids/cards/${cardId}/accept`, { method: "POST", body: JSON.stringify({}) }),

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
  // P0-4 (audit 2026-08-24) batch B: PG-CRT-03 per-drop analytics.
  creatorDropAnalytics: (dropId: string) =>
    req<{
      drop: Drop;
      cards: { total: number; sold: number; inventory: number; withBuyout: number };
      revenue: {
        soldCcoin: number;
        soldIdr: number;
        creatorSharePrimaryCcoin: number;
        creatorSharePrimaryIdr: number;
      };
    }>(`/creators/me/drops/${encodeURIComponent(dropId)}`),
  // applyCreator dihapus: docs/03_flows.md Flow 11 — kreator TIDAK self-register;
  // provisioning lewat admin (POST /api/admin/users/provision).

  // gamification
  // GET /api/gamification/leaderboard?type=...&creatorId=...&limit=...
  // `type` defaults server-side to "xp". `creatorId` REQUIRED when
  // type==="creator" (RPC rejects otherwise) and FORBIDDEN for global
  // boards. We omit the param when undefined so the server's zod
  // superRefine (no creatorId on global boards) is satisfied. Old
  // callers passing a single `limit` arg remain compatible because the
  // second arg is optional and the type is widened.
  leaderboard: (limitOrOpts: number | { type?: LeaderboardType; creatorId?: string; limit?: number } = 20) => {
    const opts = typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
    const params: Record<string, string> = {};
    if (opts.type !== undefined) params.type = opts.type;
    if (opts.creatorId !== undefined) params.creatorId = opts.creatorId;
    if (opts.limit !== undefined) params.limit = String(opts.limit);
    const qs = new URLSearchParams(params).toString();
    return req<ApiLeaderboardResponse>(`/gamification/leaderboard${qs ? `?${qs}` : ""}`);
  },
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

// Money display helpers — re-export dari @c-verse/shared (single source).
// Rate tidak lagi di-hardcode di sini; panggilan lama tetap kompatibel karena
// nama eksportnya sama (audit Lane G 2026-08-31).
export { ccoinToIdr, formatIdr } from "@c-verse/shared";
