import { describe, expect, it } from "vitest";
import {
  ASSETS_PUBLIC_URL,
  BADGE_FAMILIES,
  BADGE_TIERS,
  badgeAssetPath,
  badgeIconSrc,
  badgeProgressTarget,
  parseBadgeCriteria,
} from "./badges";

describe("badge presentation contract", () => {
  it("separates five achievement tiers and eight reusable emblems", () => {
    expect(BADGE_TIERS.map((tier) => tier.tier)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(BADGE_FAMILIES.map((family) => badgeAssetPath(family.id))).size).toBe(8);
  });
  it("serves emblems from the public R2 origin with DB icon_url override", () => {
    for (const family of BADGE_FAMILIES) {
      expect(badgeAssetPath(family.id)).toBe(`${ASSETS_PUBLIC_URL}/badges/v1/${family.id}.webp`);
    }
    expect(badgeIconSrc(undefined, "collector")).toBe(`${ASSETS_PUBLIC_URL}/badges/v1/collector.webp`);
    expect(badgeIconSrc({ iconUrl: "/badges/collector.webp", code: "collector_5" }, "collector")).toBe(
      `${ASSETS_PUBLIC_URL}/badges/v1/collector.webp`,
    );
    expect(badgeIconSrc({ iconUrl: `${ASSETS_PUBLIC_URL}/badges/v1/collector.webp`, code: "x" }, "trader", "whale")).toBe(
      `${ASSETS_PUBLIC_URL}/badges/v1/collector.webp`,
    );
  });
  it("rejects unknown or malformed criteria rather than inventing progress", () => {
    for (const value of [
      null,
      [],
      {},
      { type: "collect_count", min: 1, family: "collector", tier: 99 },
      { type: "arbitrary", min: 1, family: "collector", tier: 1 },
    ]) {
      expect(parseBadgeCriteria(value)).toBeNull();
    }
  });
  it("represents strict bid thresholds using integer C-Coin", () => {
    const criteria = parseBadgeCriteria({ type: "single_bid_gt", min: 100, family: "special", tier: 3 });
    expect(criteria).not.toBeNull();
    if (!criteria) throw new Error("Expected valid strict bid criteria");
    expect(badgeProgressTarget(criteria)).toBe(101);
  });
});
