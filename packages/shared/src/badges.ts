/** Badge rarity is separate from the account's Galactic Rank Ladder. */
export const BADGE_TIERS = [
  { tier: 1, name: "Bronze", color: "#dda67b", roman: "I" },
  { tier: 2, name: "Silver", color: "#9dd9ee", roman: "II" },
  { tier: 3, name: "Gold", color: "#ffcd63", roman: "III" },
  { tier: 4, name: "Astral", color: "#ba9bff", roman: "IV" },
  { tier: 5, name: "Nova", color: "#a1fff2", roman: "V" },
] as const;

export const BADGE_FAMILIES = [
  { id: "collector", name: "Koleksi", title: "Collector", metric: "collect_count", unit: "kartu unik", href: "/drops" },
  { id: "devotee", name: "Loyalitas", title: "Devotee", metric: "creator_cards", unit: "kartu satu kreator", href: "/browse" },
  { id: "explorer", name: "Eksplorasi", title: "Explorer", metric: "creator_count", unit: "kreator berbeda", href: "/browse" },
  { id: "archivist", name: "Ragam Drop", title: "Archivist", metric: "drop_count", unit: "Drop berbeda", href: "/drops" },
  { id: "autograph", name: "Signed", title: "Autograph", metric: "signed_count", unit: "kartu signed", href: "/browse" },
  { id: "pioneer", name: "Primer", title: "Pioneer", metric: "primary_count", unit: "kartu primer unik", href: "/drops" },
  { id: "trader", name: "Sekunder", title: "Voyager", metric: "secondary_count", unit: "kartu sekunder unik", href: "/marketplace" },
  { id: "patron", name: "Dukungan", title: "Patron", metric: "support_creators", unit: "kreator didukung", href: "/browse" },
] as const;

export type BadgeFamily = (typeof BADGE_FAMILIES)[number]["id"];
export type BadgeTier = (typeof BADGE_TIERS)[number]["tier"];
export type BadgeMetric = (typeof BADGE_FAMILIES)[number]["metric"] | "first_bid" | "single_bid_gt" | "kyc_verified";

export interface BadgeCriteria {
  type: BadgeMetric;
  min: number;
  family: BadgeFamily | "special";
  tier: BadgeTier;
}

export function parseBadgeCriteria(value: unknown): BadgeCriteria | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const metrics: readonly string[] = [...BADGE_FAMILIES.map((family) => family.metric), "first_bid", "single_bid_gt", "kyc_verified"];
  if (typeof row.type !== "string" || !metrics.includes(row.type)) return null;
  if (typeof row.min !== "number" || !Number.isSafeInteger(row.min) || row.min < 1) return null;
  if (typeof row.tier !== "number" || !BADGE_TIERS.some((tier) => tier.tier === row.tier)) return null;
  if (row.family !== "special" && !BADGE_FAMILIES.some((family) => family.id === row.family)) return null;
  return row as unknown as BadgeCriteria;
}

export function badgeAssetPath(family: BadgeFamily | "special", code?: string): string {
  const asset = family === "special" ? (code === "verified" ? "explorer" : "trader") : family;
  return `/badges/${asset}.webp`;
}

/** Strict bid thresholds use the next whole C-Coin for an honest progress bar. */
export function badgeProgressTarget(criteria: BadgeCriteria): number {
  return criteria.min + (criteria.type === "single_bid_gt" ? 1 : 0);
}
