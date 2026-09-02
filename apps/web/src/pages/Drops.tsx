import { SIGNED_PRICE_DELTA_CCOIN } from "@c-verse/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropsResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

/**
 * P1-9 (audit 2026-08-24): phase derivation dari backend fields.
 * Backend mengirim `dropStartAt`, `raffleEndAt`, `drawnAt`, `soldCount`,
 * `totalUnits`, `status` — combine untuk 5 fase UI:
 *   - upcoming : dropStart > now
 *   - raffle   : live (status) && now < raffleEndAt && !drawnAt
 *   - drawing  : live && raffleEnd elapsed && !drawnAt (cron belum jalan)
 *   - fcfs     : live && drawnAt && remaining > 0
 *   - ended    : status ended atau remaining = 0
 */
type Phase = "upcoming" | "raffle" | "drawing" | "fcfs" | "ended";

function phase(d: ApiDrop, now: number): Phase {
  const remaining = d.totalUnits - d.soldCount;
  const dropStart = d.dropStartAt ?? d.dropAt ?? null;
  if (dropStart && new Date(dropStart).getTime() > now) return "upcoming";
  if (d.drawnAt) {
    return remaining <= 0 || d.status === "sold_out" || d.status === "closed" || d.status === "cancelled" ? "ended" : "fcfs";
  }
  if (d.raffleEndAt && new Date(d.raffleEndAt).getTime() <= now) return "drawing";
  if (d.status === "live" || d.status === "published") return "raffle";
  return "ended";
}

const PHASE_LABEL: Record<Phase, string> = {
  upcoming: "Akan Datang",
  raffle: "Raffle",
  drawing: "Segera Diundi",
  fcfs: "Beli Langsung",
  ended: "Selesai",
};

const PHASE_CHIP_KEY: Record<Phase, keyof typeof PHASE_CHIP_DOT> = {
  upcoming: "upcoming",
  raffle: "live",
  drawing: "live",
  fcfs: "fcfs",
  ended: "ended",
};
const PHASE_CHIP_DOT = { live: "live", upcoming: "upcoming", fcfs: "fcfs", ended: "ended" } as const;

function formatTMinus(targetIso: string, now: number): { text: string; urgent: boolean } {
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return { text: "00:00", urgent: true };
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const urgent = diff < 60_000;
  if (days > 0) return { text: `${days}h ${String(hours).padStart(2, "0")}j ${String(mins).padStart(2, "0")}m`, urgent };
  if (hours > 0) return { text: `${hours}j ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}d`, urgent };
  return { text: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`, urgent };
}

function TMinus({ targetIso, now, label }: { targetIso: string; now: number; label: string }) {
  const cd = formatTMinus(targetIso, now);
  if (cd.text === "00:00") return null;
  return (
    <span className={`t-minus${cd.urgent ? " is-urgent" : ""}`} aria-label={`${label} ${cd.text}`}>
      <span className="t-label">{label}</span>
      <span>{cd.text}</span>
    </span>
  );
}

function initialsFromSeries(series: string | null | undefined): string {
  if (!series) return "C·C";
  const parts = series.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "C·C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function DropThumb({ d, children, showFallback = true }: { d: ApiDrop; children?: React.ReactNode; showFallback?: boolean }) {
  const hasArt = Boolean(d.artworkUrl);
  return (
    <div className="drop-thumb">
      {hasArt ? (
        <div className="art" style={{ backgroundImage: `url("${d.artworkUrl?.replace(/"/g, "%22") ?? ""}")` }} />
      ) : showFallback ? (
        <span className="art-fallback" aria-hidden="true">
          <span className="art-fallback-init">{initialsFromSeries(d.series)}</span>
        </span>
      ) : null}
      {children}
    </div>
  );
}

function SellerRow({ d }: { d: ApiDrop }) {
  const handle = d.creatorUsername ?? d.creatorHandle ?? null;
  const label = (
    <>
      <span className="seller-dot" aria-hidden="true" />
      <span className="seller-name">{d.creatorName}</span>
    </>
  );
  if (handle) {
    return (
      <Link to={`/c/${handle}`} className="seller-row" aria-label={`Halaman kreator ${d.creatorName}`} onClick={(e) => e.stopPropagation()}>
        {label}
      </Link>
    );
  }
  return <span className="seller-row">{label}</span>;
}

export default function Drops() {
  const [filter, setFilter] = useState<"all" | Phase>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "ending" | "sold" | "price">("newest");
  // Refresh tiap 60 detik agar raffleEndAt / drawnAt ter-update → phase derivation akurat.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiDropsResponse>({
    queryKey: ["drops", search],
    queryFn: ({ pageParam }) => api.drops({ ...(search ? { search } : {}), limit: "60", offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    refetchInterval: 60_000,
  });
  const allDrops: ApiDrop[] = (data?.pages ?? []).flatMap((p) => p.drops ?? []);

  // Counts per phase untuk chip badges
  const phaseCounts = useMemo(() => {
    const counts: Record<Phase, number> = { upcoming: 0, raffle: 0, drawing: 0, fcfs: 0, ended: 0 };
    for (const d of allDrops) counts[phase(d, now)]++;
    return counts;
  }, [allDrops, now]);

  const filtered = filter === "all" ? allDrops : allDrops.filter((d) => phase(d, now) === filter);

  // Featured drop: raffle live terbaru. Jika tidak ada, pilih upcoming paling dekat.
  const featured = useMemo(() => {
    const live = allDrops.filter((d) => phase(d, now) === "raffle");
    if (live.length) {
      return [...live].sort((a, b) => {
        const aEnd = a.raffleEndAt ? new Date(a.raffleEndAt).getTime() : Infinity;
        const bEnd = b.raffleEndAt ? new Date(b.raffleEndAt).getTime() : Infinity;
        return aEnd - bEnd;
      })[0];
    }
    const upcoming = allDrops.filter((d) => phase(d, now) === "upcoming");
    if (upcoming.length) {
      return [...upcoming].sort((a, b) => {
        const aStart = a.dropStartAt ?? a.dropAt ?? "";
        const bStart = b.dropStartAt ?? b.dropAt ?? "";
        return new Date(aStart).getTime() - new Date(bStart).getTime();
      })[0];
    }
    return null;
  }, [allDrops, now]);

  // Apply sort
  const drops = useMemo(() => {
    const arr = [...filtered];
    if (featured) {
      const idx = arr.findIndex((d) => d.id === featured.id);
      if (idx >= 0) arr.splice(idx, 1);
    }
    if (sort === "ending") {
      arr.sort((a, b) => {
        const ae = a.raffleEndAt ? new Date(a.raffleEndAt).getTime() : Infinity;
        const be = b.raffleEndAt ? new Date(b.raffleEndAt).getTime() : Infinity;
        return ae - be;
      });
    } else if (sort === "sold") {
      arr.sort((a, b) => b.soldCount - a.soldCount);
    } else if (sort === "price") {
      arr.sort((a, b) => (a.priceCcoin ?? a.priceUnsignedCCoin ?? 0) - (b.priceCcoin ?? b.priceUnsignedCCoin ?? 0));
    } else {
      arr.sort((a, b) => {
        const ad = a.dropStartAt ?? a.dropAt ?? a.createdAt ?? "";
        const bd = b.dropStartAt ?? b.dropAt ?? b.createdAt ?? "";
        return new Date(bd).getTime() - new Date(ad).getTime();
      });
    }
    return arr;
  }, [filtered, sort, featured]);

  const heroTicker = (
    <div className="hero-ticker" aria-hidden="true">
      <span className="ticker-label">Live Feed</span>
      <div className="ticker-track">
        <div className="ticker-scroll">
          <span className="ticker-item">
            <span className="tk-key">UNGGULAN</span>
            <span className="tk-val magenta">{featured?.title ?? "—"}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">KATALOG</span>
            <span className="tk-val cyan">{allDrops.length}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">RAFFLE</span>
            <span className="tk-val signal">{phaseCounts.raffle}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">SEGERA DIUNDI</span>
            <span className="tk-val signal">{phaseCounts.drawing}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">AKAN DATANG</span>
            <span className="tk-val cyan">{phaseCounts.upcoming}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">BELI LANGSUNG</span>
            <span className="tk-val">{phaseCounts.fcfs}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">SELESAI</span>
            <span className="tk-val">{phaseCounts.ended}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">UNGGULAN</span>
            <span className="tk-val magenta">{featured?.title ?? "—"}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">KATALOG</span>
            <span className="tk-val cyan">{allDrops.length}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">RAFFLE</span>
            <span className="tk-val signal">{phaseCounts.raffle}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">SEGERA DIUNDI</span>
            <span className="tk-val signal">{phaseCounts.drawing}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">AKAN DATANG</span>
            <span className="tk-val cyan">{phaseCounts.upcoming}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">BELI LANGSUNG</span>
            <span className="tk-val">{phaseCounts.fcfs}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">SELESAI</span>
            <span className="tk-val">{phaseCounts.ended}</span>
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="drops-stack">
      <PageHero channel="01" channelLabel="DROPS" title="Drops" ticker={heroTicker} />

      <div className="toolbar" role="search">
        <input
          className="input"
          aria-label="Cari drop"
          placeholder="Cari seri atau judul…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" aria-label="Urutkan drop" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Terbaru</option>
          <option value="ending">Segera Berakhir</option>
          <option value="sold">Paling Laris</option>
          <option value="price">Harga Terendah</option>
        </select>
        <div className="toolbar-right">
          <button className="refresh-btn" onClick={() => refetch()} aria-label="Refresh daftar drop" type="button">
            <span className="dot" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="chip-bar" role="tablist" aria-label="Filter fase drop">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={`chip${filter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Semua <span className="chip-count">{allDrops.length}</span>
        </button>
        {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => {
          const dotKey = PHASE_CHIP_KEY[p];
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={filter === p}
              className={`chip ${dotKey}${filter === p ? " active" : ""}`}
              onClick={() => setFilter(p)}
            >
              <span className="chip-dot" aria-hidden="true" />
              {PHASE_LABEL[p]} <span className="chip-count">{phaseCounts[p]}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat drop" />
      ) : !drops.length && !featured ? (
        <div className="empty-arcade">
          <div className="empty-icon" aria-hidden="true">
            NO_DATA
          </div>
          <div className="empty-title">Belum ada drop di fase ini</div>
          <p className="empty-msg">Drop baru rilis tiap hari jam 12.00 WIB.</p>
        </div>
      ) : (
        <div className="grid-3">
          {featured && filter === "all" && <NextLaunchConsole d={featured} now={now} />}
          {drops.map((d) => {
            const ph = phase(d, now);
            const remaining = Math.max(0, d.remainingUnits ?? d.totalUnits - d.soldCount);
            const pct = d.totalUnits > 0 ? Math.round((d.soldCount / d.totalUnits) * 100) : 0;
            const countdownTarget = ph === "upcoming" ? (d.dropStartAt ?? d.dropAt) : d.raffleEndAt;
            const isPulse = ph === "raffle";
            const priceReg = d.priceCcoin ?? d.priceUnsignedCCoin;
            return (
              <Link key={d.id} to={`/drops/${d.id}`} className="card drop-card" aria-label={`Detail drop ${d.title}`}>
                <DropThumb d={d}>
                  <div className="drop-thumb-overlay">
                    <StatusBadge status={d.status} kind="drop" pulse={isPulse} />
                    <span className="pill pill-muted">{PHASE_LABEL[ph]}</span>
                    {countdownTarget && ph !== "ended" && ph !== "fcfs" && (
                      <TMinus targetIso={countdownTarget} now={now} label={ph === "upcoming" ? "MENUJU RILIS" : "RAFFLE BERAKHIR"} />
                    )}
                  </div>
                  <div className="drop-thumb-corner">
                    <span
                      className="progress-ring"
                      style={{ ["--p" as never]: pct }}
                      title={`${pct}% terjual`}
                      aria-label={`${pct} persen terjual`}
                    >
                      {pct}%
                    </span>
                  </div>
                </DropThumb>
                <div className="card-pad">
                  <span className="eyebrow">{d.series}</span>
                  <div className="card-title">{d.title}</div>
                  <p className="muted muted-clamp-2">{d.narrative}</p>
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
                    <SellerRow d={d} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {hasNextPage && (
        <div className="drops-load-more">
          <button className="btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} aria-busy={isFetchingNextPage}>
            {isFetchingNextPage ? "Memuat…" : "Muat lagi"}
          </button>
        </div>
      )}
    </div>
  );
}

function NextLaunchConsole({ d, now }: { d: ApiDrop; now: number }) {
  const ph = phase(d, now);
  const remaining = Math.max(0, d.remainingUnits ?? d.totalUnits - d.soldCount);
  const pct = d.totalUnits > 0 ? Math.min(100, Math.round((d.soldCount / d.totalUnits) * 100)) : 0;
  const isLive = ph === "raffle";
  const countdownTarget = ph === "upcoming" ? (d.dropStartAt ?? d.dropAt) : d.raffleEndAt;
  const priceReg = d.priceCcoin ?? d.priceUnsignedCCoin;
  const idrReg = d.idrPrice ?? d.idrUnsigned ?? 0;
  const hasSigned = d.priceSignedCCoin !== undefined || d.idrSigned !== undefined || d.signedCount > 0;
  const priceSigned = d.priceSignedCCoin ?? priceReg + SIGNED_PRICE_DELTA_CCOIN;
  const idrSigned = d.idrSigned ?? Math.round(idrReg * (priceSigned / Math.max(priceReg, 1)));
  const tminusLabel = ph === "upcoming" ? "MENUJU RILIS" : "RAFFLE BERAKHIR";
  return (
    <Link to={`/drops/${d.id}`} className="next-launch" aria-label={`Drop unggulan: ${d.title}`}>
      <div className="next-launch-art">
        {d.artworkUrl ? (
          <img src={d.artworkUrl} alt="" />
        ) : (
          <span className="art-fallback" aria-hidden="true">
            <span className="art-fallback-init">{initialsFromSeries(d.series)}</span>
          </span>
        )}
      </div>
      <div className="next-launch-rail">
        <span className="next-launch-eyebrow">PELUNCURAN BERIKUTNYA</span>
        <div className="next-launch-title">{d.title}</div>
        <p className="next-launch-desc muted-clamp-2">{d.narrative}</p>
        <div className="card-pills">
          <StatusBadge status={d.status} kind="drop" pulse={isLive} />
          <span className="pill pill-muted">{PHASE_LABEL[ph]}</span>
          {countdownTarget && ph !== "ended" && ph !== "fcfs" && <TMinus targetIso={countdownTarget} now={now} label={tminusLabel} />}
        </div>
        <div className="price-duo">
          <div className="duo-row">
            <span className="duo-key">REGULER</span>
            <span className="duo-val">
              {priceReg}
              <span className="duo-unit">C</span>
              <span className="duo-unit">· {formatIdr(idrReg)}</span>
            </span>
          </div>
          <div className="duo-row is-signed">
            <span className="duo-key">SIGNED</span>
            <span className="duo-val">
              {priceSigned}
              <span className="duo-unit">C</span>
              <span className="duo-unit">· {formatIdr(idrSigned)}</span>
              {hasSigned ? <span className="signed-delta">+{SIGNED_PRICE_DELTA_CCOIN} C</span> : null}
            </span>
          </div>
        </div>
        <div className="launch-progress">
          <div className="launch-progress-label">
            <span className="lp-key">
              TERJUAL {d.soldCount}/{d.totalUnits}
            </span>
            <span className="lp-val">{remaining} tersisa</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="next-launch-footer">
          <SellerRow d={d} />
          <span className="footer-cta">
            Lihat Detail <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
