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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || data.message || `HTTP ${res.status}`, res.status, data.code);
  return data as T;
}

export const api = {
  // auth (Supabase Auth dipakai di lib/auth.tsx; endpoint password & demo-login dihapus per docs/10)
  me: () => req<any>("/auth/me"),
  // drops
  drops: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ drops: any[] } & PagedMeta>(`/drops${qs}`);
  },
  drop: (id: string) => req<any>(`/drops/${id}`),
  createDrop: (body: any) => req<{ drop: any }>("/drops", { method: "POST", body: JSON.stringify(body) }),
  publishDrop: (id: string, status: string) => req<any>(`/drops/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  // wallet
  wallet: () =>
    req<{
      wallet: any;
      transactions: any[];
      rate: number;
      topupCapNoKyc: number;
      minPayout: number;
      payoutHeld: boolean;
      payoutHoldUntil: string | null;
      disclosureOpsiA: string;
    }>("/wallet"),
  // payments (Midtrans): topup returns payment instruction, payout creates weekly-batch request
  topup: (amountCcoin: number) =>
    req<{
      orderId: string;
      provider: string;
      amountCcoin: number;
      amountIdr: number;
      snapToken?: string | null;
      redirectUrl?: string | null;
      expiresInMinutes?: number;
    }>("/payments/topup", { method: "POST", body: JSON.stringify({ amountCcoin }) }),
  payout: (amountCcoin: number) => req<{ payout: any }>("/payments/payout", { method: "POST", body: JSON.stringify({ amountCcoin }) }),
  // orders (primary)
  orders: () => req<{ orders: any[] }>("/orders"),
  order: (id: string) => req<{ order: any; drop: any; cards: any[]; shipments?: any[] }>(`/orders/${id}`),
  checkout: (body: {
    dropId: string;
    deliveryOption?: "shipping" | "vault";
    shippingFeeCcoin?: number | null;
    shippingAddress?: string | null;
    quantity?: number;
    variant?: string;
  }) => req<{ order: any; cards: any[]; wallet: any }>("/orders/checkout", { method: "POST", body: JSON.stringify(body) }),
  confirmDelivered: (id: string) => req<{ order: any }>(`/orders/${id}/confirm-delivered`, { method: "POST" }),
  openDispute: (orderId: string, reason: string) =>
    req<any>(`/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify({ reason }) }),
  vaultShipout: (cardId: string, address: string, feeCcoin: number) =>
    req<any>("/orders/vault-shipout", { method: "POST", body: JSON.stringify({ cardId, address, feeCcoin }) }),
  // nfc / cards (merged verify per 02-pages: card info + 3D separate)
  card: (cardId: string) => req<any>(`/nfc/cards/${encodeURIComponent(cardId)}`),
  card3d: (cardId: string) => req<any>(`/nfc/cards/${encodeURIComponent(cardId)}/3d`),
  verifyShortId: (shortId: string) => req<any>(`/nfc/verify/${encodeURIComponent(shortId)}`),
  verifyNfc: (body: { uid: string; counter?: string; cmac?: string; shortId?: string }) =>
    req<any>("/nfc/verify-nfc", { method: "POST", body: JSON.stringify(body) }),
  // marketplace (buyout on card) — list endpoint terpaginasi (limit/offset, default 60)
  marketplaceCards: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ marketplace: any[]; cards: any[] } & PagedMeta>(`/listings${qs}`);
  },
  listings: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ listings: any[]; marketplace?: any[]; cards?: any[] } & PagedMeta>(`/listings${qs}` as string);
  },
  createListing: (body: any) => req<{ listing: any; card?: any }>("/listings", { method: "POST", body: JSON.stringify(body) }),
  setBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<any>("/listings", { method: "POST", body: JSON.stringify({ cardId, buyoutPriceCcoin }) }),
  buyout: (cardId: string, destination: "buyer_address" | "platform_vault", shippingAddress?: string) =>
    req<{ ok: boolean; card: any }>("/listings/buyout", {
      method: "POST",
      body: JSON.stringify({ cardId, destination, ...(shippingAddress ? { shippingAddress } : {}) }),
    }),
  patchBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<any>(`/listings/cards/${cardId}/buyout`, { method: "PATCH", body: JSON.stringify({ buyoutPriceCcoin }) }),
  // browse
  browse: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ cards: any[]; results: any[] } & PagedMeta>(`/browse${qs}`);
  },
  // bids (direct on card)
  placeBid: (cardId: string, amountCcoin: number, listingId?: string) =>
    req<{ bid: any; activeBid?: any; listing?: any }>(`/bids`, {
      method: "POST",
      body: JSON.stringify({ cardId, amountCCoin: amountCcoin, amountCcoin: amountCcoin, ...(listingId ? { listingId } : {}) }),
    }),
  cancelBid: (bidId: string) => req<any>(`/bids/${bidId}/cancel`, { method: "POST" }),
  acceptBidOnCard: (cardId: string, destination?: "buyer_address" | "platform_vault", shippingAddress?: string) =>
    req<any>(`/bids/cards/${cardId}/accept`, {
      method: "POST",
      body: JSON.stringify({ destination, ...(shippingAddress ? { shippingAddress } : {}) }),
    }),
  // profile
  profile: () => req<any>("/profile"),
  myCards: () => req<{ cards: any[] }>("/profile/cards"),
  patchPrivacy: (isAnonymous: boolean) => req<any>("/profile/privacy", { method: "PATCH", body: JSON.stringify({ isAnonymous }) }),
  patchConsent: (body: { consentAnalyticsDetail?: boolean; consentDataMarket?: boolean }) =>
    req<any>("/profile/consent", { method: "PATCH", body: JSON.stringify(body) }),
  patchProfile: (body: Record<string, string>) => req<any>("/profile", { method: "PATCH", body: JSON.stringify(body) }),
  // public profile / creator
  publicProfile: (username: string) => req<any>(`/public/u/${encodeURIComponent(username)}`),
  creatorPublic: (idOrHandle: string) => req<any>(`/creators/${encodeURIComponent(idOrHandle)}`),
  applyCreator: () => req<{ creator: { handle: string; status: string; message: string } }>("/creators/apply", { method: "POST" }),
  // gamification
  leaderboard: (limit = 20) => req<{ leaderboard: any[] }>(`/gamification/leaderboard?limit=${limit}`),
  badges: () => req<{ badges: any[] }>("/gamification/badges"),
  // kyc
  kyc: () => req<{ kyc: any }>("/kyc"),
  submitKyc: (body: any) => req<{ kyc: any }>("/kyc", { method: "POST", body: JSON.stringify(body) }),
};
export function ccoinToIdr(c: number, rate = 10000) {
  return c * rate;
}
export function formatIdr(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
