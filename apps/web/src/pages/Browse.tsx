import { useInfiniteQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropsResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

const PAGE_LIMIT = 60;

function initialsFromSeries(series: string | null | undefined): string {
  if (!series) return "C·C";
  const parts = series.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "C·C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Drop tile markup shared with Drops page — reuse global .drop-card styles. */
function DropTile({ d }: { d: ApiDrop }) {
  const pct = d.totalUnits > 0 ? Math.round((d.soldCount / d.totalUnits) * 100) : 0;
  const remaining = Math.max(0, d.remainingUnits ?? d.totalUnits - d.soldCount);
  const priceReg = d.priceCcoin ?? d.priceUnsignedCCoin;
  return (
    <Link to={`/drops/${d.id}`} className="card drop-card" aria-label={`Detail drop ${d.title}`}>
      <div className="drop-thumb">
        {d.artworkUrl ? (
          <div className="art" style={{ backgroundImage: `url("${d.artworkUrl.replace(/"/g, "%22")}")` }} />
        ) : (
          <span className="art-fallback" aria-hidden="true">
            <span className="art-fallback-init">{initialsFromSeries(d.series)}</span>
          </span>
        )}
        <div className="drop-thumb-overlay">
          <StatusBadge status={d.status} kind="drop" pulse={d.status === "live"} />
        </div>
        <div className="drop-thumb-corner">
          <span className="progress-ring" style={{ ["--p" as never]: pct }} title={`${pct}% terjual`} aria-label={`${pct} persen terjual`}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="card-pad">
        <span className="eyebrow">{d.series}</span>
        <div className="card-title">{d.title}</div>
        <div className="card-meta-row">
          <div className="card-price">
            <div className="price-val">{priceReg} C</div>
            <div className="price-idr">· {formatIdr(d.idrPrice ?? d.idrUnsigned ?? 0)}</div>
          </div>
          <div className="card-stock">
            <span className="stock-line">
              <strong>{d.soldCount}</strong>
              <span className="stock-divider"> / {d.totalUnits}</span>
            </span>
            <span className="stock-pct">{remaining} tersisa</span>
          </div>
        </div>
        {d.signedCount > 0 ? (
          <div className="card-pills">
            <span className="pill pill-muted">✍ signed {d.signedCount}</span>
          </div>
        ) : null}
        <div className="card-creator">
          <span className="seller-row">
            <span className="seller-dot" aria-hidden="true" />
            <span className="seller-name">{d.creatorName}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Browse() {
  const { data, refetch, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiDropsResponse>({
    queryKey: ["browse-drops"],
    queryFn: ({ pageParam }) => api.drops({ limit: String(PAGE_LIMIT), offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  const drops: ApiDrop[] = (data?.pages ?? []).flatMap((p) => p.drops ?? []);
  const totalSold = drops.reduce((sum, d) => sum + d.soldCount, 0);
  const totalUnits = drops.reduce((sum, d) => sum + d.totalUnits, 0);
  const tickerItems = [
    { key: "DROP", val: String(drops.length), cls: "cyan" },
    { key: "UNIT TERJUAL", val: String(totalSold), cls: "signal" },
    { key: "UNIT TOTAL", val: String(totalUnits), cls: "" },
  ];
  return (
    <div className="page-stack">
      <PageHero
        channel="03"
        channelLabel="JELAJAHI"
        title="Jelajahi"
        ticker={
          <div className="hero-ticker" aria-hidden="true">
            <span className="ticker-label">Ringkasan</span>
            <div className="ticker-track">
              <div className="ticker-scroll">
                {[0, 1].map((copy) => (
                  <Fragment key={copy}>
                    {tickerItems.map((item) => (
                      <span key={item.key}>
                        <span className="ticker-item">
                          <span className="tk-key">{item.key}</span>
                          <span className={`tk-val ${item.cls}`}>{item.val}</span>
                        </span>
                        <span className="ticker-item">
                          <span className="tk-sep" aria-hidden="true" />
                        </span>
                      </span>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        }
      />

      <div className="toolbar">
        <div className="toolbar-right">
          <button className="refresh-btn" onClick={() => refetch()} aria-label="Refresh daftar drop" type="button">
            <span className="dot" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat drop" />
      ) : drops.length === 0 ? (
        <div className="empty-arcade">
          <div className="empty-icon" aria-hidden="true">
            NO_HITS
          </div>
          <div className="empty-title">Belum ada drop</div>
          <p className="empty-msg">Drop baru rilis tiap hari jam 12.00 WIB.</p>
        </div>
      ) : (
        <div className="grid-3">
          {drops.map((d) => (
            <DropTile key={d.id} d={d} />
          ))}
        </div>
      )}
      {hasNextPage && (
        <button className="btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Memuat…" : "Muat lagi"}
        </button>
      )}
    </div>
  );
}
