import type { ReactNode } from "react";

type PageHeroProps = {
  channel: string;
  channelLabel: string;
  title: string;
  sub?: string | null;
  desc?: string | null;
  ticker?: ReactNode | null;
  actions?: ReactNode | null;
};

export function PageHero({ channel, channelLabel, title, sub, desc, ticker, actions }: PageHeroProps) {
  return (
    <section className="page-hero" aria-label={`Header halaman ${title}`}>
      <div className="page-hero-rail">
        <span className="rail-channel">
          CH:{channel} / {channelLabel}
        </span>
      </div>
      <div className="page-hero-inner">
        <div className="page-hero-copy">
          <h1 className="page-hero-title">{title}</h1>
          {sub ? <div className="page-hero-sub">{sub}</div> : null}
          {desc ? <p className="page-hero-desc">{desc}</p> : null}
        </div>
        {actions ? <div className="page-hero-actions">{actions}</div> : null}
      </div>
      {ticker ?? null}
    </section>
  );
}
