import { calcSignedCount, calcUnsignedCount, C_COIN_RATE_IDR } from "@c-verse/shared";

// ── Types (align docs/05-data-model) ───────────────────────────────────────
export type UserRole = "user" | "creator" | "admin";
export type LegacyCollector = "collector"; // alias
export type AnyRole = UserRole | LegacyCollector;
export type DropStatus = "draft" | "scheduled" | "published" | "live" | "sold_out" | "closed" | "cancelled" | "review" | "approved" | "production" | "ended";
export type OrderStatus = "paid" | "qc" | "shipped" | "delivered" | "settled" | "refunded" | "disputed" | "pending" | "processing" | "cancelled";
export type DeliveryOption = "shipping" | "vault";
export type EscrowStatus = "held" | "released";
export type CardLocation = "platform_stock" | "with_owner" | "platform_vault";
export type CardStatus = "inventory" | "bound" | "listed_buyout" | "bid_pending" | "sold" | "tampered" | "defect" | "lost" | "available" | "listed" | "transferred";
export type ShipmentType = "primary_shipping" | "primary_vault" | "secondary_buyout" | "secondary_bid" | "vault_shipout";
export type ShipmentToDest = "buyer_address" | "platform_vault";
export type ShipmentStatus = "requested" | "packed" | "shipped" | "delivered" | "cancelled";
export type BidStatus = "active" | "outbid" | "cancelled" | "accepted";
export type VerifyStatus = "verified" | "tamper_detected" | "registered" | "unknown";
export type ListingStatus = "draft" | "listed" | "bidding" | "awaiting_settlement" | "settled" | "expired" | "cancelled" | "failed";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  username?: string | null;
  role: AnyRole;
  avatarUrl: string | null;
  xp: number; // legacy
  totalXp: number;
  level: number;
  cumulativeSpendCcoin: number;
  isAnonymous: boolean;
  createdAt: string;
}

export interface CreatorRec {
  id: string;
  userId: string | null;
  handle: string;
  totalFollowersCombined: number;
  status: "active" | "suspended" | "inactive";
  bankAccount: Record<string, string> | null;
  notes: string | null;
  createdAt: string;
}

export interface Drop {
  id: string;
  title: string;
  series: string;
  narrative: string;
  artworkUrl: string;
  artwork3dUrl?: string | null;
  totalUnits: number;
  signedCount: number;
  unsignedCount: number;
  priceUnsignedCCoin: number;
  priceSignedCCoin: number;
  priceCcoin: number; // canonical single price (MVP platform-produced)
  status: DropStatus;
  dropAt: string | null; // legacy
  dropStartAt: string | null;
  dropEndAt: string | null;
  creatorId: string;
  creatorName: string;
  soldCount: number;
  createdAt: string;
  createdBy?: string | null;
}

export interface Card {
  id: string;
  dropId: string;
  unitNumber: number;
  variant: "unsigned" | "signed";
  status: CardStatus;
  // new canonical
  location: CardLocation;
  buyoutPriceCcoin: number | null; // null = not listed
  nfcConfigured: boolean;
  qcStatus: "pending" | "passed" | "failed";
  ownerId: string | null;
  nfcUid: string;
  nfcShortId: string;
  verifyStatus: VerifyStatus;
  createdAt?: string;
}

export interface Wallet {
  userId: string;
  balanceCCoin: number;
  totalTopupCCoin: number;
  totalSpentCCoin: number;
  updatedAt?: string;
}

export interface WalletTx {
  id: string;
  userId: string;
  type: string; // topup/checkout/... may be top_up etc.
  amountCCoin: number;
  balanceAfterCCoin: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface Order {
  id: string;
  userId: string;
  dropId: string;
  cardIds: string[]; // legacy multi
  cardId: string | null; // canonical 1:1
  totalCCoin: number;
  totalIdr: number;
  status: OrderStatus;
  deliveryOption: DeliveryOption;
  shippingFeeCcoin: number | null;
  escrowStatus: EscrowStatus;
  shippingAddress: string | null;
  trackingNumber: string | null;
  shippedAt?: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface Shipment {
  id: string;
  cardId: string;
  requesterId: string;
  type: ShipmentType;
  fromLocation: "platform" | "seller";
  toDest: ShipmentToDest;
  address: string | Record<string, unknown> | null;
  feeCcoin: number | null;
  status: ShipmentStatus;
  trackingNumber: string | null;
  platformCheck?: Record<string, unknown> | null;
  createdAt: string;
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
  cardId: string | null;
  listingId: string | null;
  bidderId: string;
  bidderName: string;
  amountCCoin: number;
  status: BidStatus;
  createdAt: string;
  outbidAt?: string | null;
  cancelledAt?: string | null;
  acceptedAt?: string | null;
}

export interface BadgeDef {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  iconUrl?: string | null;
  xp: number;
  xpReward: number;
  criteria?: Record<string, unknown> | null;
  isActive?: boolean;
}

export interface UserBadge {
  userId: string;
  badgeId: string;
  earnedAt: string;
  awardedAt?: string;
  xpRewardSnapshot?: number;
}

export interface KycRecord {
  id: string;
  userId: string;
  fullName: string;
  nik: string;
  address: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt?: string;
}

export interface OwnershipHistory {
  id: string;
  cardId: string;
  ownerId: string;
  acquiredVia: "primary" | "secondary_buyout" | "secondary_bid" | "gift";
  orderId: string | null;
  bidId: string | null;
  transferredAt: string;
}

export interface AuditLog {
  id: string;
  adminUserId: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  payloadSummary: Record<string, unknown> | null;
  ip: string | null;
  sessionId: string | null;
  createdAt: string;
}

function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function nowIso(): string { return new Date().toISOString(); }

// ── Global singleton ───────────────────────────────────────────────────────
class Store {
  users: Map<string, User> = new Map();
  creators: Map<string, CreatorRec> = new Map();
  drops: Map<string, Drop> = new Map();
  cards: Map<string, Card> = new Map();
  wallets: Map<string, Wallet> = new Map();
  walletTx: WalletTx[] = [];
  orders: Map<string, Order> = new Map();
  shipments: Map<string, Shipment> = new Map();
  listings: Map<string, Listing> = new Map();
  bids: Bid[] = [];
  badges: BadgeDef[] = [];
  userBadges: UserBadge[] = [];
  kyc: Map<string, KycRecord> = new Map();
  ownershipHistory: OwnershipHistory[] = [];
  auditLog: AuditLog[] = [];
  sessions: Map<string, string> = new Map();
  seeded = false;
}

export const store = new Store();

// ── Seed (matches supabase/seed.sql rework) ───────────────────────────────
export function ensureSeed() {
  if (store.seeded) return;
  store.seeded = true;

  store.badges = [
    { id: "b1", code: "first_drop", name: "First Drop", description: "Beli pertama kali", icon: "🎴", iconUrl: "🎴", xp: 100, xpReward: 100, criteria: { type: "collect_count", min: 1 }, isActive: true },
    { id: "b2", code: "first_bid", name: "First Bid", description: "Bid pertama", icon: "🔨", iconUrl: "🔨", xp: 50, xpReward: 50, criteria: { type: "first_bid" }, isActive: true },
    { id: "b3", code: "collector_5", name: "Collector", description: "Koleksi 5 kartu", icon: "🌟", iconUrl: "🌟", xp: 200, xpReward: 200, criteria: { type: "collect_count", min: 5 }, isActive: true },
    { id: "b4", code: "curator", name: "Curator", description: "10 kartu kreator sama", icon: "🎨", iconUrl: "🎨", xp: 300, xpReward: 300, criteria: { type: "creator_cards", min: 10 }, isActive: true },
    { id: "b5", code: "whale", name: "Whale", description: "Single bid > 100 C-Coin", icon: "🐋", iconUrl: "🐋", xp: 500, xpReward: 500, criteria: { type: "single_bid_gt", min: 100 }, isActive: true },
    { id: "b6", code: "verified", name: "Verified", description: "KYC terverifikasi", icon: "✅", iconUrl: "✅", xp: 50, xpReward: 50, criteria: { type: "kyc_verified" }, isActive: true },
  ];

  const demoUsers: User[] = [
    { id: "u_demo", email: "demo@cverse.id", passwordHash: "demo123", displayName: "Demo Kolektor", username: "demo_kolektor", role: "user", avatarUrl: null, xp: 45, totalXp: 45, level: 5, cumulativeSpendCcoin: 30, isAnonymous: false, createdAt: nowIso() },
    { id: "u_admin", email: "admin@cverse.id", passwordHash: "admin123", displayName: "Admin C.Verse", username: "admin", role: "admin", avatarUrl: null, xp: 0, totalXp: 0, level: 1, cumulativeSpendCcoin: 0, isAnonymous: false, createdAt: nowIso() },
    { id: "cr_karina", email: "karina@creator.id", passwordHash: "x", displayName: "Karina Aespa", username: "karina_aespa", role: "creator", avatarUrl: null, xp: 120, totalXp: 120, level: 13, cumulativeSpendCcoin: 0, isAnonymous: false, createdAt: nowIso() },
    { id: "cr_hype", email: "hype@creator.id", passwordHash: "x", displayName: "HypeCreator", username: "hypecreator", role: "creator", avatarUrl: null, xp: 90, totalXp: 90, level: 10, cumulativeSpendCcoin: 0, isAnonymous: false, createdAt: nowIso() },
    { id: "cr_nova", email: "nova@creator.id", passwordHash: "x", displayName: "Nova Studio", username: "nova_studio", role: "creator", avatarUrl: null, xp: 60, totalXp: 60, level: 7, cumulativeSpendCcoin: 0, isAnonymous: false, createdAt: nowIso() },
  ];
  for (const u of demoUsers) {
    // keep legacy xp = totalXp for calcLevel callers using user.xp
    store.users.set(u.id, u);
    store.wallets.set(u.id, { userId: u.id, balanceCCoin: u.id === "u_demo" ? 120 : u.id === "cr_karina" ? 0 : 50, totalTopupCCoin: u.id === "u_demo" ? 150 : 0, totalSpentCCoin: u.id === "u_demo" ? 30 : 0, updatedAt: nowIso() });
  }
  store.sessions.set("demo-token", "u_demo");
  store.sessions.set("admin-token", "u_admin");

  store.creators.set("cr-karina", { id: "cr-karina", userId: "cr_karina", handle: "karina_aespa", totalFollowersCombined: 185000, status: "active", bankAccount: { bank: "BCA", account_no: "1234567890", holder: "Karina" }, notes: "Rekrut via DM IG", createdAt: nowIso() });
  store.creators.set("cr-hype", { id: "cr-hype", userId: "cr_hype", handle: "hypecreator", totalFollowersCombined: 320000, status: "active", bankAccount: { bank: "Mandiri", account_no: "9876543210", holder: "HypeCreator" }, notes: "Referral founder", createdAt: nowIso() });
  store.creators.set("cr-nova", { id: "cr-nova", userId: "cr_nova", handle: "nova_studio", totalFollowersCombined: 110000, status: "active", bankAccount: { bank: "BCA", account_no: "1122334455", holder: "Nova Studio" }, notes: "Found via search", createdAt: nowIso() });

  const drops: Drop[] = [
    {
      id: "drop-aespa-2025", title: "Karina — Limited Genesis", series: "HypeCreator X Aespa (2025 Limited Series)",
      narrative: "Kolaborasi eksklusif Karina Aespa dengan HypeCreator. Acrylic hardcase premium + NFC anti-tamper cryptographic. Hanya 15 unit di dunia.",
      artworkUrl: "/textures/karina.jpg", totalUnits: 15, signedCount: 2, unsignedCount: 13,
      priceUnsignedCCoin: 30, priceSignedCCoin: 50, priceCcoin: 30, status: "live", dropAt: new Date(Date.now() - 3600_000).toISOString(), dropStartAt: new Date(Date.now() - 3600_000).toISOString(), dropEndAt: null,
      creatorId: "cr_karina", creatorName: "Karina Aespa", soldCount: 6, createdAt: nowIso(),
    },
    {
      id: "drop-genesis-alpha", title: "Genesis Alpha", series: "Creator X — Alpha Series",
      narrative: "Genesis drop dari Creator X. Desain bold, holo foil, acrylic tebal 3mm. Koleksi pembuka C.Verse.",
      artworkUrl: "/textures/genesis.jpg", totalUnits: 20, signedCount: 2, unsignedCount: 18,
      priceUnsignedCCoin: 25, priceSignedCCoin: 45, priceCcoin: 25, status: "live", dropAt: new Date(Date.now() - 7200_000).toISOString(), dropStartAt: new Date(Date.now() - 7200_000).toISOString(), dropEndAt: null,
      creatorId: "cr_hype", creatorName: "HypeCreator", soldCount: 12, createdAt: nowIso(),
    },
    {
      id: "drop-nova-01", title: "Neon Bloom #01", series: "Nova Studio — Neon Bloom",
      narrative: "Neon Bloom mengeksplor gradien neon & organic shapes. Tiap kartu punya nomor seri & sertifikat digital.",
      artworkUrl: "/textures/neon.jpg", totalUnits: 12, signedCount: 2, unsignedCount: 10,
      priceUnsignedCCoin: 20, priceSignedCCoin: 40, priceCcoin: 20, status: "scheduled", dropAt: new Date(Date.now() + 86400_000 * 2).toISOString(), dropStartAt: new Date(Date.now() + 86400_000 * 2).toISOString(), dropEndAt: null,
      creatorId: "cr_nova", creatorName: "Nova Studio", soldCount: 0, createdAt: nowIso(),
    },
    {
      id: "drop-aespa-signed", title: "Karina — Signed Vault", series: "HypeCreator X Aespa — Signed Vault",
      narrative: "Signed edition — ditandatangani kreator, insert premium, hanya 1 per 10 kartu.",
      artworkUrl: "/textures/karina-signed.jpg", totalUnits: 10, signedCount: 1, unsignedCount: 9,
      priceUnsignedCCoin: 30, priceSignedCCoin: 55, priceCcoin: 30, status: "ended", dropAt: new Date(Date.now() - 86400_000 * 7).toISOString(), dropStartAt: new Date(Date.now() - 86400_000 * 7).toISOString(), dropEndAt: null,
      creatorId: "cr_karina", creatorName: "Karina Aespa", soldCount: 10, createdAt: nowIso(),
    },
  ];
  for (const d of drops) store.drops.set(d.id, d);

  for (const d of drops) {
    for (let i = 1; i <= d.totalUnits; i++) {
      const variant = i <= d.signedCount ? "signed" as const : "unsigned" as const;
      const prefix = d.id.replace(/[^a-z0-9]/gi,"").slice(-4).toLowerCase() || d.id.slice(0,4); const shortId = `${prefix}-${String(i).padStart(3, "0")}`;
      const uidHex = `04A1${Math.random().toString(16).slice(2, 10).padEnd(8, "0").toUpperCase()}${String(i).padStart(2, "0")}`;
      const isSold = i <= d.soldCount;
      const ownerId = isSold ? (i % 3 === 0 ? "u_demo" : i % 2 === 0 ? "u_admin" : "cr_hype") : null;
      let status: CardStatus = isSold ? "sold" : "available";
      let location: CardLocation = isSold ? "with_owner" : "platform_stock";
      let buyout: number | null = null;
      if (d.id === "drop-aespa-2025" && i === 3 && isSold) { status = "listed"; buyout = 45; location = "with_owner"; }
      if (d.id === "drop-genesis-alpha" && i === 2 && isSold) { status = "sold"; location = "platform_vault"; }
      const card: Card = {
        id: `card-${d.id}-${String(i).padStart(2, "0")}`,
        dropId: d.id, unitNumber: i, variant,
        status, location, buyoutPriceCcoin: buyout, nfcConfigured: true, qcStatus: isSold ? "passed" : "pending",
        ownerId, nfcUid: uidHex, nfcShortId: shortId, verifyStatus: "verified",
      };
      store.cards.set(card.id, card);
    }
  }

  store.walletTx.push(
    { id: uid("wtx-"), userId: "u_demo", type: "topup", amountCCoin: 100, balanceAfterCCoin: 100, refType: "topup", refId: "top-1", note: "Top-up via QRIS", createdAt: new Date(Date.now() - 86400_000 * 3).toISOString() },
    { id: uid("wtx-"), userId: "u_demo", type: "topup", amountCCoin: 50, balanceAfterCCoin: 150, refType: "topup", refId: "top-2", note: "Top-up via VA BCA", createdAt: new Date(Date.now() - 86400_000).toISOString() },
    { id: uid("wtx-"), userId: "u_demo", type: "checkout", amountCCoin: -30, balanceAfterCCoin: 120, refType: "order", refId: "ord-demo", note: "Checkout Karina #03", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  );

  const orderDemo: Order = {
    id: "ord-demo", userId: "u_demo", dropId: "drop-aespa-2025", cardIds: ["card-drop-aespa-2025-03"], cardId: "card-drop-aespa-2025-03",
    totalCCoin: 30, totalIdr: 30 * C_COIN_RATE_IDR, status: "shipped",
    deliveryOption: "shipping", shippingFeeCcoin: 2, escrowStatus: "held",
    shippingAddress: "Jl. Demo No. 1, Jakarta Selatan", trackingNumber: "JNE-881200334455", shippedAt: new Date(Date.now() - 30 * 60000).toISOString(), deliveredAt: null, createdAt: new Date(Date.now() - 3600_000).toISOString(),
  };
  store.orders.set(orderDemo.id, orderDemo);
  const orderVault: Order = {
    id: "ord-vault-demo", userId: "u_demo", dropId: "drop-genesis-alpha", cardIds: ["card-drop-genesis-alpha-02"], cardId: "card-drop-genesis-alpha-02",
    totalCCoin: 25, totalIdr: 25 * C_COIN_RATE_IDR, status: "settled",
    deliveryOption: "vault", shippingFeeCcoin: null, escrowStatus: "released",
    shippingAddress: null, trackingNumber: null, deliveredAt: null, createdAt: new Date(Date.now() - 86400_000 * 5).toISOString(),
  };
  store.orders.set(orderVault.id, orderVault);

  store.shipments.set("ship-demo-1", { id: "ship-demo-1", cardId: "card-drop-aespa-2025-03", requesterId: "u_demo", type: "primary_shipping", fromLocation: "platform", toDest: "buyer_address", address: { street: "Jl. Demo No. 1, Jakarta Selatan" }, feeCcoin: 2, status: "shipped", trackingNumber: "JNE-881200334455", createdAt: new Date(Date.now() - 3600_000).toISOString() });
  store.shipments.set("ship-vault-1", { id: "ship-vault-1", cardId: "card-drop-genesis-alpha-02", requesterId: "u_demo", type: "primary_vault", fromLocation: "platform", toDest: "platform_vault", address: null, feeCcoin: null, status: "delivered", trackingNumber: null, createdAt: new Date(Date.now() - 86400_000 * 5).toISOString() });

  store.ownershipHistory.push(
    { id: "oh-demo-1", cardId: "card-drop-aespa-2025-03", ownerId: "u_demo", acquiredVia: "primary", orderId: "ord-demo", bidId: null, transferredAt: new Date(Date.now() - 3600_000).toISOString() },
    { id: "oh-vault-1", cardId: "card-drop-genesis-alpha-02", ownerId: "u_demo", acquiredVia: "primary", orderId: "ord-vault-demo", bidId: null, transferredAt: new Date(Date.now() - 86400_000 * 5).toISOString() },
  );

  const listingDemo: Listing = {
    id: "lst-001", cardId: "card-drop-aespa-2025-03", sellerId: "u_demo", type: "auction",
    priceCCoin: 45, reserveCCoin: 35, currentBidCCoin: 42, currentBidderId: "u_admin",
    status: "bidding", endsAt: new Date(Date.now() + 86400_000 * 2).toISOString(), createdAt: new Date(Date.now() - 86400_000).toISOString(),
  };
  store.listings.set(listingDemo.id, listingDemo);
  store.bids.push(
    { id: uid("bid-"), cardId: "card-drop-aespa-2025-03", listingId: "lst-001", bidderId: "u_admin", bidderName: "Admin C.Verse", amountCCoin: 38, status: "outbid", createdAt: new Date(Date.now() - 3600_000 * 5).toISOString(), outbidAt: new Date(Date.now() - 3600_000).toISOString() },
    { id: uid("bid-"), cardId: "card-drop-aespa-2025-03", listingId: "lst-001", bidderId: "cr_hype", bidderName: "HypeCreator", amountCCoin: 42, status: "active", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  );

  store.userBadges.push({ userId: "u_demo", badgeId: "b1", earnedAt: new Date(Date.now() - 86400_000 * 2).toISOString(), awardedAt: new Date(Date.now() - 86400_000 * 2).toISOString(), xpRewardSnapshot: 100 });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export function getUserByToken(token: string | undefined): User | null {
  if (!token) return null;
  const uid2 = store.sessions.get(token);
  if (!uid2) return null;
  return store.users.get(uid2) || null;
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
  if (!w) { w = { userId, balanceCCoin: 0, totalTopupCCoin: 0, totalSpentCCoin: 0, updatedAt: nowIso() }; store.wallets.set(userId, w); }
  return w;
}
export function addTx(userId: string, type: string, amountCCoin: number, refType: string | null, refId: string | null, note: string | null, metadata?: Record<string, unknown> | null) {
  const w = ensureWallet(userId);
  w.balanceCCoin += amountCCoin;
  if (amountCCoin > 0 && (type === "topup" || type === "top_up")) w.totalTopupCCoin += amountCCoin;
  if (amountCCoin < 0) w.totalSpentCCoin += Math.abs(amountCCoin);
  // mirror spend to cumulative + totalXp (docs/07 C-05c: spend 1 C-Coin = 1 XP)
  const user = store.users.get(userId);
  if (user && amountCCoin < 0 && (type === "checkout" || type === "settlement" || type.includes("checkout"))) {
    const spend = Math.abs(amountCCoin);
    user.cumulativeSpendCcoin = (user.cumulativeSpendCcoin ?? 0) + spend;
    user.totalXp = (user.totalXp ?? user.xp ?? 0) + spend;
    user.xp = user.totalXp; // keep alias in sync
    user.level = Math.max(1, Math.floor(user.totalXp / 10) + 1);
  }
  const tx: WalletTx = { id: uid("wtx-"), userId, type, amountCCoin, balanceAfterCCoin: w.balanceCCoin, refType, refId, note, createdAt: nowIso(), metadata: metadata ?? null };
  store.walletTx.push(tx);
  if (user) user.level = Math.max(1, Math.floor((user.totalXp ?? user.xp) / 10) + 1);
  return tx;
}
export function awardBadgeIfNeeded(userId: string, badgeId: string) {
  if (store.userBadges.find(ub => ub.userId === userId && ub.badgeId === badgeId)) return false;
  const def = store.badges.find(b => b.id === badgeId);
  const reward = def?.xpReward ?? def?.xp ?? 0;
  store.userBadges.push({ userId, badgeId, earnedAt: nowIso(), awardedAt: nowIso(), xpRewardSnapshot: reward });
  const user = store.users.get(userId);
  if (user && reward > 0) {
    user.totalXp = (user.totalXp ?? user.xp ?? 0) + reward;
    user.xp = user.totalXp;
    user.level = Math.max(1, Math.floor(user.totalXp / 10) + 1);
  }
  return true;
}
export function evaluateBadges(userId: string) {
  // Event-driven per docs/05 — run after any XP-affecting action (checkout, bid accept, etc.)
  // Criteria types: collect_count{min}, creator_cards{creator_id?,min}, xp_total{min}, single_bid_gt{min}, level{min}, first_bid, kyc_verified
  const cardsOwned = [...store.cards.values()].filter((c) => c.ownerId === userId).length;
  const totalXp = (store.users.get(userId) as unknown as { totalXp?: number }).totalXp ?? (store.users.get(userId) as unknown as { xp?: number }).xp ?? 0;
  const userLevel = Math.max(1, Math.floor(totalXp / 10) + 1);
  const hasAnyBid = store.bids.some((b) => b.bidderId === userId);
  const maxSingleBid = Math.max(0, ...store.bids.filter((b) => b.bidderId === userId).map((b) => b.amountCCoin));
  const kycOk = isKycApproved(userId);
  for (const def of store.badges.filter((b) => b.isActive !== false)) {
    if (store.userBadges.find((ub) => ub.userId === userId && ub.badgeId === def.id)) continue;
    const cr = (def.criteria ?? {}) as Record<string, unknown>;
    let ok = false;
    const t = String((cr as { type?: string }).type ?? "");
    const min = Number((cr as { min?: number }).min ?? 0);
    if (t === "collect_count") ok = cardsOwned >= min;
    else if (t === "creator_cards") {
      const cid = (cr as { creator_id?: string }).creator_id ?? (cr as { creatorId?: string }).creatorId;
      if (cid) ok = [...store.cards.values()].filter((c) => c.ownerId === userId && store.drops.get(c.dropId)?.creatorId === cid).length >= min;
      else ok = [...store.cards.values()].filter((c) => c.ownerId === userId).length >= min;
    } else if (t === "xp_total") ok = totalXp >= min;
    else if (t === "single_bid_gt") ok = maxSingleBid > min;
    else if (t === "level") ok = userLevel >= min;
    else if (t === "first_bid") ok = hasAnyBid;
    else if (t === "kyc_verified") ok = kycOk;
    if (ok) awardBadgeIfNeeded(userId, def.id);
  }
}
export function isKycApproved(userId: string): boolean {
  const rec = [...store.kyc.values()].find(k => k.userId === userId);
  return rec?.status === "approved";
}
export function cumulativeTopup(userId: string): number {
  // sum of topup tx for threshold >99 check
  return store.walletTx.filter(t => t.userId === userId && (t.type === "topup" || t.type === "top_up") && t.amountCCoin > 0).reduce((n, t) => n + t.amountCCoin, 0);
}
export function logAudit(adminUserId: string, action: string, targetTable: string, targetId: string | null, payloadSummary: Record<string, unknown> | null, ip: string | null, sessionId: string | null) {
  const entry: AuditLog = { id: uid("audit-"), adminUserId, action, targetTable, targetId, payloadSummary, ip, sessionId, createdAt: nowIso() };
  store.auditLog.unshift(entry);
  return entry;
}
export { uid, nowIso };
