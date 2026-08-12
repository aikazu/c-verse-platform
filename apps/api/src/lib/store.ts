import { calcSignedCount, calcUnsignedCount, C_COIN_RATE_IDR } from "@c-verse/shared";

// ── Types re-exported for store ──
export type DropStatus = "draft" | "review" | "approved" | "production" | "scheduled" | "live" | "ended" | "cancelled";
export type OrderStatus = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";
export type ListingStatus = "draft" | "listed" | "bidding" | "awaiting_settlement" | "settled" | "expired" | "cancelled" | "failed";
export type VerifyStatus = "verified" | "tamper_detected" | "registered" | "unknown";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: "collector" | "creator" | "admin";
  avatarUrl: string | null;
  xp: number;
  createdAt: string;
}

export interface Drop {
  id: string;
  title: string;
  series: string;
  narrative: string;
  artworkUrl: string;
  totalUnits: number;
  signedCount: number;
  unsignedCount: number;
  priceUnsignedCCoin: number;
  priceSignedCCoin: number;
  status: DropStatus;
  dropAt: string | null;
  creatorId: string;
  creatorName: string;
  soldCount: number;
  createdAt: string;
}

export interface Card {
  id: string;
  dropId: string;
  unitNumber: number;
  variant: "unsigned" | "signed";
  status: "available" | "sold" | "listed" | "transferred";
  ownerId: string | null;
  nfcUid: string;
  nfcShortId: string;
  verifyStatus: VerifyStatus;
}

export interface Wallet {
  userId: string;
  balanceCCoin: number;
  totalTopupCCoin: number;
  totalSpentCCoin: number;
}

export interface WalletTx {
  id: string;
  userId: string;
  type: "topup" | "checkout" | "refund" | "payout" | "royalty" | "fee" | "hold" | "release";
  amountCCoin: number;
  balanceAfterCCoin: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  dropId: string;
  cardIds: string[];
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  shippingAddress: string;
  trackingNumber: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface Listing {
  id: string;
  cardId: string;
  sellerId: string;
  type: "fixed" | "auction";
  priceCCoin: number;
  reserveCCoin: number | null;
  currentBidCCoin: number | null;
  currentBidderId: string | null;
  status: ListingStatus;
  endsAt: string;
  createdAt: string;
}

export interface Bid {
  id: string;
  listingId: string;
  bidderId: string;
  bidderName: string;
  amountCCoin: number;
  createdAt: string;
}

export interface BadgeDef {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
}

export interface UserBadge {
  userId: string;
  badgeId: string;
  earnedAt: string;
}

export interface KycRecord {
  id: string;
  userId: string;
  fullName: string;
  nik: string;
  address: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowIso(): string { return new Date().toISOString(); }

// ── Global singleton store (in-memory) ──
class Store {
  users: Map<string, User> = new Map();
  drops: Map<string, Drop> = new Map();
  cards: Map<string, Card> = new Map();
  wallets: Map<string, Wallet> = new Map();
  walletTx: WalletTx[] = [];
  orders: Map<string, Order> = new Map();
  listings: Map<string, Listing> = new Map();
  bids: Bid[] = [];
  badges: BadgeDef[] = [];
  userBadges: UserBadge[] = [];
  kyc: Map<string, KycRecord> = new Map();
  // sessions token -> userId
  sessions: Map<string, string> = new Map();
  seeded = false;
}

export const store = new Store();

// ── Seed ──
export function ensureSeed() {
  if (store.seeded) return;
  store.seeded = true;

  // Badges
  store.badges = [
    { id: "b1", code: "first_drop", name: "First Drop", description: "Beli pertama kali", icon: "🎴", xp: 100 },
    { id: "b2", code: "first_bid", name: "First Bid", description: "Bid pertama", icon: "🔨", xp: 50 },
    { id: "b3", code: "collector_5", name: "Collector", description: "Koleksi 5 kartu", icon: "🌟", xp: 200 },
    { id: "b4", code: "curator", name: "Curator", description: "10 kartu kreator sama", icon: "🎨", xp: 300 },
    { id: "b5", code: "whale", name: "Whale", description: "Single bid > 100 C-Coin", icon: "🐋", xp: 500 },
    { id: "b6", code: "verified", name: "Verified", description: "KYC terverifikasi", icon: "✅", xp: 50 },
  ];

  // Demo users
  const demoUsers: User[] = [
    { id: "u_demo", email: "demo@cverse.id", passwordHash: "demo123", displayName: "Demo Kolektor", role: "collector", avatarUrl: null, xp: 450, createdAt: nowIso() },
    { id: "u_admin", email: "admin@cverse.id", passwordHash: "admin123", displayName: "Admin C.Verse", role: "admin", avatarUrl: null, xp: 0, createdAt: nowIso() },
    { id: "cr_karina", email: "karina@creator.id", passwordHash: "x", displayName: "Karina Aespa", role: "creator", avatarUrl: null, xp: 1200, createdAt: nowIso() },
    { id: "cr_hype", email: "hype@creator.id", passwordHash: "x", displayName: "HypeCreator", role: "creator", avatarUrl: null, xp: 900, createdAt: nowIso() },
    { id: "cr_nova", email: "nova@creator.id", passwordHash: "x", displayName: "Nova Studio", role: "creator", avatarUrl: null, xp: 600, createdAt: nowIso() },
  ];
  for (const u of demoUsers) {
    store.users.set(u.id, u);
    store.wallets.set(u.id, { userId: u.id, balanceCCoin: u.id === "u_demo" ? 120 : u.id === "cr_karina" ? 0 : 50, totalTopupCCoin: u.id === "u_demo" ? 150 : 0, totalSpentCCoin: u.id === "u_demo" ? 30 : 0 });
  }
  store.sessions.set("demo-token", "u_demo");
  store.sessions.set("admin-token", "u_admin");

  // Drops
  const drops: Drop[] = [
    {
      id: "drop-aespa-2025", title: "Karina — Limited Genesis", series: "HypeCreator X Aespa (2025 Limited Series)",
      narrative: "Kolaborasi eksklusif Karina Aespa dengan HypeCreator. Acrylic hardcase premium + NFC TagTamper cryptographic. Hanya 15 unit di dunia.",
      artworkUrl: "/textures/karina.jpg", totalUnits: 15, signedCount: 2, unsignedCount: 13,
      priceUnsignedCCoin: 30, priceSignedCCoin: 50, status: "live", dropAt: new Date(Date.now() - 3600_000).toISOString(),
      creatorId: "cr_karina", creatorName: "Karina Aespa", soldCount: 6, createdAt: nowIso(),
    },
    {
      id: "drop-genesis-alpha", title: "Genesis Alpha", series: "Creator X — Alpha Series",
      narrative: "Genesis drop dari Creator X. Desain bold, holo foil, acrylic tebal 3mm. Koleksi pembuka C.Verse.",
      artworkUrl: "/textures/genesis.jpg", totalUnits: 20, signedCount: 2, unsignedCount: 18,
      priceUnsignedCCoin: 25, priceSignedCCoin: 45, status: "live", dropAt: new Date(Date.now() - 7200_000).toISOString(),
      creatorId: "cr_hype", creatorName: "HypeCreator", soldCount: 12, createdAt: nowIso(),
    },
    {
      id: "drop-nova-01", title: "Neon Bloom #01", series: "Nova Studio — Neon Bloom",
      narrative: "Neon Bloom mengeksplor gradien neon & organic shapes. Tiap kartu punya nomor seri & sertifikat digital.",
      artworkUrl: "/textures/neon.jpg", totalUnits: 12, signedCount: 2, unsignedCount: 10,
      priceUnsignedCCoin: 20, priceSignedCCoin: 40, status: "scheduled", dropAt: new Date(Date.now() + 86400_000 * 2).toISOString(),
      creatorId: "cr_nova", creatorName: "Nova Studio", soldCount: 0, createdAt: nowIso(),
    },
    {
      id: "drop-aespa-signed", title: "Karina — Signed Vault", series: "HypeCreator X Aespa — Signed Vault",
      narrative: "Signed edition — ditandatangani kreator, insert premium, hanya 1 per 10 kartu.",
      artworkUrl: "/textures/karina-signed.jpg", totalUnits: 10, signedCount: 1, unsignedCount: 9,
      priceUnsignedCCoin: 30, priceSignedCCoin: 55, status: "ended", dropAt: new Date(Date.now() - 86400_000 * 7).toISOString(),
      creatorId: "cr_karina", creatorName: "Karina Aespa", soldCount: 10, createdAt: nowIso(),
    },
  ];
  for (const d of drops) store.drops.set(d.id, d);

  // Cards for each drop
  for (const d of drops) {
    for (let i = 1; i <= d.totalUnits; i++) {
      const variant = i <= d.signedCount ? "signed" as const : "unsigned" as const;
      const shortId = `${d.id.slice(0, 4)}-${String(i).padStart(3, "0")}`;
      const uidHex = `04A1${Math.random().toString(16).slice(2, 10).padEnd(8, "0").toUpperCase()}${String(i).padStart(2, "0")}`;
      const isSold = i <= d.soldCount;
      const ownerId = isSold ? (i % 3 === 0 ? "u_demo" : i % 2 === 0 ? "u_admin" : "cr_hype") : null;
      const card: Card = {
        id: `card-${d.id}-${String(i).padStart(2, "0")}`,
        dropId: d.id, unitNumber: i, variant,
        status: isSold ? (i === 3 && d.id === "drop-aespa-2025" ? "listed" : "sold") : "available",
        ownerId, nfcUid: uidHex, nfcShortId: shortId, verifyStatus: "verified",
      };
      store.cards.set(card.id, card);
    }
  }

  // Wallet tx demo
  store.walletTx.push(
    { id: uid("wtx-"), userId: "u_demo", type: "topup", amountCCoin: 100, balanceAfterCCoin: 100, refType: "topup", refId: "top-1", note: "Top-up via QRIS", createdAt: new Date(Date.now() - 86400_000 * 3).toISOString() },
    { id: uid("wtx-"), userId: "u_demo", type: "topup", amountCCoin: 50, balanceAfterCCoin: 150, refType: "topup", refId: "top-2", note: "Top-up via VA BCA", createdAt: new Date(Date.now() - 86400_000).toISOString() },
    { id: uid("wtx-"), userId: "u_demo", type: "checkout", amountCCoin: -30, balanceAfterCCoin: 120, refType: "order", refId: "ord-demo", note: "Checkout Karina #03", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  );

  // Order demo
  const orderDemo: Order = {
    id: "ord-demo", userId: "u_demo", dropId: "drop-aespa-2025", cardIds: ["card-drop-aespa-2025-03"],
    totalCCoin: 30, totalIdr: 30 * C_COIN_RATE_IDR, status: "shipped",
    shippingAddress: "Jl. Demo No. 1, Jakarta Selatan", trackingNumber: "JNE-881200334455", createdAt: new Date(Date.now() - 3600_000).toISOString(), deliveredAt: null,
  };
  store.orders.set(orderDemo.id, orderDemo);

  // Secondary listing demo
  const listingDemo: Listing = {
    id: "lst-001", cardId: "card-drop-aespa-2025-03", sellerId: "u_demo", type: "auction",
    priceCCoin: 45, reserveCCoin: 35, currentBidCCoin: 42, currentBidderId: "u_admin",
    status: "bidding", endsAt: new Date(Date.now() + 86400_000 * 2).toISOString(), createdAt: new Date(Date.now() - 86400_000).toISOString(),
  };
  store.listings.set(listingDemo.id, listingDemo);
  store.bids.push(
    { id: uid("bid-"), listingId: "lst-001", bidderId: "u_admin", bidderName: "Admin C.Verse", amountCCoin: 38, createdAt: new Date(Date.now() - 3600_000 * 5).toISOString() },
    { id: uid("bid-"), listingId: "lst-001", bidderId: "cr_hype", bidderName: "HypeCreator", amountCCoin: 42, createdAt: new Date(Date.now() - 3600_000).toISOString() },
  );

  // User badges
  store.userBadges.push({ userId: "u_demo", badgeId: "b1", earnedAt: new Date(Date.now() - 86400_000 * 2).toISOString() });
}

// Helpers
export function getUserByToken(token: string | undefined): User | null {
  if (!token) return null;
  const uid = store.sessions.get(token);
  if (!uid) return null;
  return store.users.get(uid) || null;
}
export function authHeaderToToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : authHeader;
}
export function makeToken(userId: string): string {
  const t = `tok-${userId}-${Math.random().toString(36).slice(2, 8)}`;
  store.sessions.set(t, userId);
  return t;
}
export function ensureWallet(userId: string): Wallet {
  let w = store.wallets.get(userId);
  if (!w) { w = { userId, balanceCCoin: 0, totalTopupCCoin: 0, totalSpentCCoin: 0 }; store.wallets.set(userId, w); }
  return w;
}
export function addTx(userId: string, type: WalletTx["type"], amountCCoin: number, refType: string | null, refId: string | null, note: string | null) {
  const w = ensureWallet(userId);
  w.balanceCCoin += amountCCoin;
  if (amountCCoin > 0 && type === "topup") w.totalTopupCCoin += amountCCoin;
  if (amountCCoin < 0) w.totalSpentCCoin += Math.abs(amountCCoin);
  const tx: WalletTx = { id: uid("wtx-"), userId, type, amountCCoin, balanceAfterCCoin: w.balanceCCoin, refType, refId, note, createdAt: nowIso() };
  store.walletTx.push(tx);
  return tx;
}
export { uid, nowIso };
