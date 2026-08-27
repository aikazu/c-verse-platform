// apps/web/src/components/CardThumb.tsx
//
// Presentational card-artwork block: real artwork when available, monogram
// initials (or diamond glyph) otherwise. Fills its parent box (width/height
// 100% via .ct-wrap; child <img> uses object-fit: cover). Replaces the
// hard-coded emoji placeholders that lived inline in Home / DropDetail /
// Collection / CardInfo. The hero fake card on Landing uses a different
// visual vocabulary and is intentionally NOT routed through this component.

import type { CSSProperties } from "react";
import "./CardThumb.css";

export interface CardThumbProps {
  artworkUrl?: string | null;
  series?: string;
  title?: string;
  className?: string;
  /** Set true on the page's primary hero art (DropDetail, CardInfo) so the
   *  LCP image begins loading immediately. Home and Collection stay lazy. */
  eager?: boolean;
}

// Up to 2 uppercase initials from the first two words, joined by any
// separator (space, hyphen, etc.). Falls back to ◆ when the input has no
// uppercase-mappable letter (digits, symbols, non-Latin scripts).
function monogram(series: string | null | undefined, title: string | null | undefined): string {
  const source = `${series ?? ""} ${title ?? ""}`.trim();
  if (!source) return "";
  const parts = source.split(/[\s-]+/).filter(Boolean);
  const letters: string[] = [];
  for (const part of parts) {
    if (letters.length >= 2) break;
    const upper = part.toUpperCase();
    if (upper[0] && upper[0] !== upper[0].toLowerCase()) letters.push(upper[0]);
  }
  return letters.length > 0 ? letters.join("") : "◆";
}

export function CardThumb({ artworkUrl, series, title, className, eager }: CardThumbProps) {
  const hasArt = Boolean(artworkUrl);
  const init = monogram(series, title);
  const wrapClass = ["ct-wrap", className].filter(Boolean).join(" ");
  const artStyle: CSSProperties = hasArt ? { backgroundImage: `url("${(artworkUrl ?? "").replace(/"/g, "%22")}")` } : {};
  return (
    <div className={wrapClass}>
      {hasArt ? (
        <img className="ct-img" src={artworkUrl ?? ""} alt="" loading={eager ? "eager" : "lazy"} style={artStyle} />
      ) : (
        <span className="ct-fallback" aria-hidden="true">
          {init ? <span className="ct-fallback-init">{init}</span> : <span className="ct-fallback-glyph">◆</span>}
        </span>
      )}
    </div>
  );
}
