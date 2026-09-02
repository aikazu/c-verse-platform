import type { ReactNode } from "react";

type PageHeroProps = {
  channel: string;
  channelLabel: string;
  extra?: string | null;
  title: string;
  sub?: string | null;
  desc?: string | null;
  ticker?: ReactNode | null;
  actions?: ReactNode | null;
  heroVisual?: ReactNode | null;
};

export function PageHero({ channel, channelLabel, extra, title, sub, desc, ticker, actions, heroVisual }: PageHeroProps) {
  const ariaLabel = `Header halaman ${title}`;
  return (
    <section className="page-hero" aria-label={ariaLabel}>
      <div className="page-hero-rail">
        <span className="rail-channel">
          CH:{channel} / {channelLabel}
        </span>
        <span className="rail-dot" aria-hidden="true" />
        {extra ? (
          <>
            <span className="rail-sep">·</span>
            <span className="rail-extra">{extra}</span>
          </>
        ) : null}
        <span className="rail-time" aria-label="Siap">
          <span className="rail-cursor" aria-hidden="true" />
        </span>
      </div>
      {/* H1 kept for a11y/SEO but visually hidden — no repeated word on screen */}
      <h1 className="sr-only">{title}</h1>
      {(heroVisual || sub || desc || actions) && (
        <div className="page-hero-inner">
          {heroVisual ? (
            <div className="page-hero-visual" aria-hidden="true">
              {heroVisual}
            </div>
          ) : null}
          {(sub || desc) && (
            <div className="page-hero-copy">
              {sub ? <div className="page-hero-sub">{sub}</div> : null}
              {desc ? <p className="page-hero-desc">{desc}</p> : null}
            </div>
          )}
          {actions ? <div className="page-hero-actions">{actions}</div> : null}
        </div>
      )}
      {ticker ? <>{ticker}</> : null}
    </section>
  );
}
