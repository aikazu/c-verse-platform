const API = (typeof window !== "undefined" && (window as any).__API_URL__) || "";

function getToken(): string | null {
  try { return localStorage.getItem("cverse_token"); } catch { return null; }
}
function authHeaders(): Record<string,string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string,string> = { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers as Record<string,string>||{}) };
  const res = await fetch(`/api${path}`, { ...opts, headers });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  // auth
  login: (email:string,password:string) => req<{token:string;user:any}>("/auth/login",{method:"POST",body:JSON.stringify({email,password})}),
  register: (email:string,password:string,displayName:string)=> req<{token:string;user:any}>("/auth/register",{method:"POST",body:JSON.stringify({email,password,displayName})}),
  demoLogin: () => req<{token:string;user:any}>("/auth/demo-login",{method:"POST"}),
  me: () => req<any>("/auth/me"),
  logout: () => req("/auth/logout",{method:"POST"}),
  // drops
  drops: (params?:Record<string,string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{drops:any[]}>(`/drops${qs}`);
  },
  drop: (id:string) => req<any>(`/drops/${id}`),
  createDrop: (body:any) => req<{drop:any}>("/drops",{method:"POST",body:JSON.stringify(body)}),
  // wallet
  wallet: () => req<{wallet:any;transactions:any[];rate:number}>("/wallet"),
  topup: (amountCCoin:number,method:string) => req<{wallet:any;transaction:any}>("/wallet/topup",{method:"POST",body:JSON.stringify({amountCCoin,method})}),
  payout: (amountCCoin:number) => req<any>("/wallet/payout",{method:"POST",body:JSON.stringify({amountCCoin})}),
  // orders
  orders: () => req<{orders:any[]}>("/orders"),
  order: (id:string) => req<{order:any;drop:any;cards:any[]}>("/orders/"+id),
  checkout: (body:{dropId:string;quantity:number;variant:string;shippingAddress:string}) => req<{order:any;cards:any[];wallet:any}>("/orders/checkout",{method:"POST",body:JSON.stringify(body)}),
  confirmDelivered: (id:string) => req<{order:any}>(`/orders/${id}/confirm-delivered`,{method:"POST"}),
  // nfc
  verifyShortId: (shortId:string)=> req<any>(`/nfc/verify/${encodeURIComponent(shortId)}`),
  verifyNfc: (body:{uid:string;counter?:string;cmac?:string;shortId?:string})=> req<any>("/nfc/verify-nfc",{method:"POST",body:JSON.stringify(body)}),
  // listings
  listings: (params?:Record<string,string>)=> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return req<{listings:any[]}>(`/listings${qs}`);
  },
  listing: (id:string)=> req<{listing:any;card:any;drop:any;seller:any;bids:any[]; }>(`/listings/${id}`),
  createListing: (body:any)=> req<{listing:any}>("/listings",{method:"POST",body:JSON.stringify(body)}),
  buyNow: (id:string)=> req<any>(`/listings/${id}/buy-now`,{method:"POST"}),
  cancelListing: (id:string)=> req<any>(`/listings/${id}`,{method:"DELETE"}),
  // bids
  bids: (listingId:string)=> req<{bids:any[]}>(`/bids/${listingId}`),
  placeBid: (listingId:string,amountCCoin:number)=> req<{bid:any;listing:any}>("/bids",{method:"POST",body:JSON.stringify({listingId,amountCCoin})}),
  acceptBid: (listingId:string)=> req<any>(`/bids/${listingId}/accept`,{method:"POST"}),
  // profile
  profile: ()=> req<any>("/profile"),
  myCards: ()=> req<{cards:any[]}>("/profile/cards"),
  // gamification
  leaderboard: (limit=20)=> req<{leaderboard:any[]}>(`/gamification/leaderboard?limit=${limit}`),
  badges: ()=> req<{badges:any[]}>("/gamification/badges"),
  // creators
  creators: ()=> req<{creators:any[]}>("/creators"),
  creator: (id:string)=> req<any>(`/creators/${id}`),
  // kyc
  kyc: ()=> req<{kyc:any}>("/kyc"),
  kycAll: ()=> req<{kyc:any[]}>("/kyc/admin/all"),
  submitKyc: (body:any)=> req<{kyc:any}>("/kyc",{method:"POST",body:JSON.stringify(body)}),
  approveKyc: (id:string)=> req<any>(`/kyc/${id}/approve`,{method:"POST"}),

  // helpers
  getToken, authHeaders,
};

export function saveToken(t:string){ try{ localStorage.setItem("cverse_token",t);}catch{} }
export function clearToken(){ try{ localStorage.removeItem("cverse_token");}catch{} }
export function ccoinToIdr(c:number, rate=10000){ return c*rate; }
export function formatIdr(n:number){ return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n); }
export function formatCCoin(c:number){ return `${c} C-Coin`; }
