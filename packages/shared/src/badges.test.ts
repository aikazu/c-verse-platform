import { describe, expect, it } from "vitest";
import { BADGE_FAMILIES, BADGE_TIERS, badgeAssetPath, badgeProgressTarget, parseBadgeCriteria } from "./badges";

describe("badge presentation contract", () => {
  it("separates five achievement tiers and eight reusable emblems", () => {
    expect(BADGE_TIERS.map((tier) => tier.tier)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(BADGE_FAMILIES.map((family) => badgeAssetPath(family.id))).size).toBe(8);
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
