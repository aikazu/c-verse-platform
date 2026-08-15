const API_BASE = "";

function getToken(): string | null {
  try {
    return localStorage.getItem("cverse_token");
  } catch {
    return null;
  }
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((opts.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${API_BASE}/api${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    req<{ token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, displayName: string) =>
    req<{ token: string; user: any }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) }),
  demoLogin: () => req<{ token: string; user: any }>("/auth/demo-login", { method: "POST" }),
  me: () => req<any>("/auth/me"),
  logout: () => req("/auth/logout", { method: "POST" }),
  // drops
  drops: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ drops: any[] }>(`/drops${qs}`);
  },
  drop: (id: string) => req<any>(`/drops/${id}`),
  createDrop: (body: any) => req<{ drop: any }>("/drops", { method: "POST", body: JSON.stringify(body) }),
  // wallet
  wallet: () => req<{ wallet: any; transactions: any[]; rate: number }>("/wallet"),
  topup: (amountCCoin: number, method: string) =>
    req<{ wallet: any; transaction: any }>("/wallet/topup", { method: "POST", body: JSON.stringify({ amountCCoin, method }) }),
  topupAlias: (body: { amountCCoin?: number; amountCcoin?: number; method?: string }) =>
    req<{ wallet: any; transaction: any }>("/wallet/topup", { method: "POST", body: JSON.stringify(body) }),
  payout: (amountCCoin: number) => req<any>("/wallet/payout", { method: "POST", body: JSON.stringify({ amountCCoin }) }),
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
  vaultShipout: (cardId: string, address: string, feeCcoin: number) =>
    req<any>("/orders/vault-shipout", { method: "POST", body: JSON.stringify({ cardId, address, feeCcoin }) }),
  // nfc / cards (merged verify per 02-pages: card info + 3D separate)
  card: (cardId: string) => req<any>(`/nfc/cards/${encodeURIComponent(cardId)}`),
  card3d: (cardId: string) => req<any>(`/nfc/cards/${encodeURIComponent(cardId)}/3d`),
  verifyShortId: (shortId: string) => req<any>(`/nfc/verify/${encodeURIComponent(shortId)}`),
  verifyNfc: (body: { uid: string; counter?: string; cmac?: string; shortId?: string }) =>
    req<any>("/nfc/verify-nfc", { method: "POST", body: JSON.stringify(body) }),
  // marketplace (buyout on card)
  marketplaceCards: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ marketplace: any[]; cards: any[] }>(`/listings${qs}`);
  },
  listings: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ listings: any[]; marketplace?: any[] }>(`/listings${qs}` as string);
  },
  listing: (id: string) => req<{ listing: any; card: any; drop: any; seller: any; bids: any[] }>(`/listings/${id}`),
  createListing: (body: any) => req<{ listing: any; card?: any }>("/listings", { method: "POST", body: JSON.stringify(body) }),
  setBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<any>("/listings", { method: "POST", body: JSON.stringify({ cardId, buyoutPriceCcoin }) }),
  buyout: (cardId: string) => req<any>("/listings/buyout", { method: "POST", body: JSON.stringify({ cardId }) }),
  patchBuyout: (cardId: string, buyoutPriceCcoin: number | null) =>
    req<any>(`/listings/cards/${cardId}/buyout`, { method: "PATCH", body: JSON.stringify({ buyoutPriceCcoin }) }),
  buyNow: (id: string) => req<any>(`/listings/${id}/buy-now`, { method: "POST" }),
  cancelListing: (id: string) => req<any>(`/listings/${id}`, { method: "DELETE" }),
  // browse
  browse: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{ cards: any[]; results: any[] }>(`/browse${qs}`);
  },
  browseCard: (cardId: string) => req<any>(`/browse/cards/${cardId}`),
  // bids (direct on card)
  bids: (id: string) => req<{ bids: any[] }>(`/bids/${id}` as string),
  bidsForCard: (cardId: string) => req<{ bids: any[] }>(`/bids/card/${cardId}`),
  placeBid: (cardId: string, amountCcoin: number, listingId?: string) =>
    req<{ bid: any; activeBid?: any; listing?: any }>(`/bids`, {
      method: "POST",
      body: JSON.stringify({ cardId, amountCCoin: amountCcoin, amountCcoin: amountCcoin, ...(listingId ? { listingId } : {}) }),
    }),
  placeBidLegacy: (listingId: string, amountCCoin: number) =>
    req<{ bid: any; listing: any }>("/bids", { method: "POST", body: JSON.stringify({ listingId, amountCCoin }) }),
  cancelBid: (bidId: string) => req<any>(`/bids/${bidId}/cancel`, { method: "POST" }),
  acceptBidLegacy: (listingId: string) => req<any>(`/bids/${listingId}/accept`, { method: "POST" }),
  acceptBidOnCard: (cardId: string, destination?: "buyer_address" | "platform_vault") =>
    req<any>(`/bids/cards/${cardId}/accept`, { method: "POST", body: JSON.stringify(destination ? { destination } : {}) }),
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
  // shipments
  shipments: () => req<{ shipments: any[] }>("/shipments"),
  shipment: (id: string) => req<any>(`/shipments/${id}`),
  // gamification
  leaderboard: (limit = 20) => req<{ leaderboard: any[] }>(`/gamification/leaderboard?limit=${limit}`),
  badges: () => req<{ badges: any[] }>("/gamification/badges"),
  badgesFor: (userId: string) => req<{ badges: any[] }>(`/gamification/badges/${userId}`),
  // creators (list)
  creators: () => req<{ creators: any[] }>("/creators"),
  creator: (id: string) => req<any>(`/creators/${id}`),
  // kyc
  kyc: () => req<{ kyc: any }>("/kyc"),
  kycAll: () => req<{ kyc: any[] }>("/kyc/admin/all"),
  submitKyc: (body: any) => req<{ kyc: any }>("/kyc", { method: "POST", body: JSON.stringify(body) }),
  approveKyc: (id: string) => req<any>(`/kyc/${id}/approve`, { method: "POST" }),

  // helpers
  getToken,
  authHeaders,
};
export function saveToken(t: string) {
  try {
    localStorage.setItem("cverse_token", t);
  } catch {}
}
export function clearToken() {
  try {
    localStorage.removeItem("cverse_token");
  } catch {}
}
export function ccoinToIdr(c: number, rate = 10000) {
  return c * rate;
}
export function formatIdr(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
export function formatCCoin(c: number) {
  return `${c} C-Coin`;
}
