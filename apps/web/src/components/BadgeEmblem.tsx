import type { Badge, BadgeFamily, BadgeTier } from "@c-verse/shared";
import { BADGE_TIERS, badgeIconSrc, parseBadgeCriteria } from "@c-verse/shared";
import type { CSSProperties } from "react";
import "./badge-emblem.css";

type BadgeEmblemProps = {
  badge?: Badge;
  family?: BadgeFamily | "special";
  tier?: BadgeTier;
  size?: "compact" | "standard" | "hero";
  className?: string;
  label?: string;
};

const DEFAULT_FAMILY: BadgeFamily = "collector";
const DEFAULT_TIER: BadgeTier = 1;

/**
 * One composited, lazy-loaded family emblem. The rarity is built around the
 * shared base image, so the catalogue avoids shipping five large assets for
 * each badge family.
 */
export function BadgeEmblem({ badge, family, tier, size = "standard", className = "", label }: BadgeEmblemProps) {
  const criteria = badge ? parseBadgeCriteria(badge.criteria) : null;
  const resolvedFamily = family ?? criteria?.family ?? DEFAULT_FAMILY;
  const resolvedTier = tier ?? criteria?.tier ?? DEFAULT_TIER;
  const tierMeta = BADGE_TIERS.find((item) => item.tier === resolvedTier) ?? BADGE_TIERS[0];
  const accessibleLabel = label ?? (badge ? `${badge.name}, tingkat lencana ${tierMeta.name}` : `Tingkat lencana ${tierMeta.name}`);

  return (
    <span
      className={`badge-emblem badge-emblem--${size} badge-emblem--tier-${resolvedTier} ${className}`}
      style={{ "--badge-metal": tierMeta.color } as CSSProperties}
      role="img"
      aria-label={accessibleLabel}
    >
      <span className="badge-emblem__halo" aria-hidden="true" />
      <span className="badge-emblem__frame" aria-hidden="true">
        <img src={badgeIconSrc(badge, resolvedFamily, badge?.code)} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="badge-emblem__tier" aria-hidden="true">
        {tierMeta.roman}
      </span>
    </span>
  );
}
