type PageHeroProps = {
  channel: string;
  channelLabel: string;
  extra?: string | null;
  title: string;
  titleEmphasis?: string | null;
  sub?: string | null;
  desc?: string | null;
  ticker?: React.ReactNode | null;
  actions?: React.ReactNode | null;
};

export function PageHero({ channel, channelLabel, extra, title, titleEmphasis, sub, desc, ticker, actions }: PageHeroProps) {
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
      <div className="page-hero-inner">
        <div className="page-hero-copy">
          {sub ? <div className="page-hero-sub">{sub}</div> : null}
          <h1 className="page-hero-title">
            {titleEmphasis ? (
              <>
                {title} <em>{titleEmphasis}</em>
              </>
            ) : (
              title
            )}
          </h1>
          {desc ? <p className="page-hero-desc">{desc}</p> : null}
        </div>
        {actions ? <div className="page-hero-actions">{actions}</div> : null}
      </div>
      {ticker ? <>{ticker}</> : null}
    </section>
  );
}
