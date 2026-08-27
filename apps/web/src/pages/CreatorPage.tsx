import type { LeaderboardEntry, LevelTier } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, api } from "../lib/api";
import type { ApiCreatorPublicResponse, ApiDrop, ApiLeaderboardResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import "./creator.css";

// Operator-channel for sibling-lane collision check: CH:06 / KREATOR
// (Drops CH:01, Marketplace CH:02, Browse CH:03, Leaderboard CH:04, Profile CH:05).
const CHANNEL = "CH:06 / KREATOR";
const CHANNEL_EXTRA = "CREATOR LOG";

const VALID_TIERS = new Set<LevelTier>(["bronze", "silver", "gold", "platinum", "diamond"]);
function tierOf(s: string): LevelTier {
  return (VALID_TIERS.has(s as LevelTier) ? s : "bronze") as LevelTier;
}

function getSigil(displayName: string, handle: string | null | undefined): string {
  const source = displayName?.trim() || handle?.trim() || "?";
  const cleaned = source.replace(/^@+/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

function thumbSigil(title: string, series: string): string {
  const source = (series || title || "?").trim();
  const cleaned = source.replace(/^@+/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

export default function CreatorPage() {
  const { username } = useParams();
  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchCreator,
    isFetching,
  } = useQuery<ApiCreatorPublicResponse>({
    queryKey: ["creator-pub", username],
    queryFn: () => api.creatorPublic(username!),
    enabled: !!username,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 1;
    },
  });

  // The /api/creators/:id route returns `creator.id` = userId (creators.ts:115/129)
  // — that's the value the leaderboard RPC expects as `creatorId` for the
  // collector board. We only enable this query once we actually have it,
  // otherwise the request would 400 with missing-creatorId before navigation
  // resolves.
  const creatorUserId = data?.creator?.id;
  const {
    data: boardData,
    isLoading: boardLoading,
    isError: boardError,
    refetch: refetchBoard,
  } = useQuery<ApiLeaderboardResponse>({
    queryKey: ["leaderboard", "creator", creatorUserId],
    queryFn: () => api.leaderboard({ type: "creator", creatorId: creatorUserId as string, limit: 10 }),
    enabled: !!creatorUserId,
  });

  const notFound = isError && error instanceof ApiError && error.status === 404;

  const retryBoth = () => {
    void refetchCreator();
    if (creatorUserId) void refetchBoard();
  };

  if (isLoading) {
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil kreator">
          <div className="page-hero-rail">
            <span className="rail-channel">{CHANNEL}</span>
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-sep">·</span>
            <span className="rail-extra">{CHANNEL_EXTRA}</span>
            <span className="rail-time" aria-label="Memuat">
              <span className="rail-cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="page-hero-inner">
            <div className="page-hero-copy">
              <div className="page-hero-sub">@{username ?? "—"}</div>
              <h1 className="page-hero-title">Memuat kreator…</h1>
              <p className="page-hero-desc">Menghubungkan ke konsol kreator C.Verse.</p>
            </div>
          </div>
        </section>
        <LoadingState label="Memuat kreator…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil kreator">
          <div className="page-hero-rail">
            <span className="rail-channel">{CHANNEL}</span>
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-sep">·</span>
            <span className="rail-extra">SIGNAL LOST</span>
            <span className="rail-time" aria-label="Tidak ditemukan">
              <span className="rail-cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="page-hero-inner">
            <div className="page-hero-copy">
              <div className="page-hero-sub">@{username ?? "—"}</div>
              <h1 className="page-hero-title">Kreator tidak ditemukan</h1>
              <p className="page-hero-desc">Handle yang diminta tidak ada di katalog kreator publik.</p>
            </div>
          </div>
        </section>
        <div className="empty-arcade cp-empty" role="status">
          <div className="empty-icon" aria-hidden="true">
            404
          </div>
          <div className="empty-title">Kreator tidak ditemukan</div>
          <p className="empty-msg">Handle @{username ?? "—"} belum terdaftar atau bukan kreator publik.</p>
          <div className="empty-cta">
            <Link className="btn-ghost" to="/">
              Kembali ke Beranda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil kreator">
          <div className="page-hero-rail">
            <span className="rail-channel">{CHANNEL}</span>
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-sep">·</span>
            <span className="rail-extra">SIGNAL ERROR</span>
            <span className="rail-time" aria-label="Gagal">
              <span className="rail-cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="page-hero-inner">
            <div className="page-hero-copy">
              <h1 className="page-hero-title">Gagal memuat kreator</h1>
              <p className="page-hero-desc">Konsol tidak dapat menghubungi server. Coba ulangi sebentar lagi.</p>
            </div>
          </div>
        </section>
        <ErrorState onRetry={retryBoth} label="Gagal memuat profil kreator" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-stack">
        <ErrorState onRetry={() => void refetchCreator()} label="Kreator tidak ditemukan" />
      </div>
    );
  }

  const creator = data.creator;
  const drops: ApiDrop[] = creator.drops ?? [];
  // doc 02 PG-CRT-PUB-01 hanya handle + drop list (tanpa follower count, tanpa bio / links
  // — API tidak mengembalikan field tersebut saat ini).
  const handle = creator.handle ?? creator.username ?? null;
  const board: LeaderboardEntry[] = boardData?.leaderboard ?? [];
  const sigil = getSigil(creator.displayName, handle);
  const handleLine = handle ? `@${handle}` : `@${username ?? ""}`;

  // Distinct series count — derived from the actually loaded drops payload,
  // never an identifier. Replaces the old "ID" ticker cell which leaked the
  // creator userId prefix into the UI.
  const distinctSeries = new Set(drops.map((d) => d.series).filter(Boolean)).size;

  const tickerItems = [
    { key: "RILISAN", value: `${drops.length}`, accent: "gold" as const },
    { key: "KOLEKTOR", value: `${board.length}`, accent: "cyan" as const },
    { key: "SERI", value: `${distinctSeries}`, accent: "signal" as const },
    {
      key: "STATUS",
      value: drops.some((d) => d.status === "live") ? "LIVE" : "STANDBY",
      accent: drops.some((d) => d.status === "live") ? ("signal" as const) : ("muted" as const),
    },
  ];

  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Profil kreator">
        <div className="page-hero-rail">
          <span className="rail-channel">{CHANNEL}</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">{CHANNEL_EXTRA}</span>
          <span className="rail-time" aria-label={isFetching ? "Memuat ulang" : "Siap"}>
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <div className="page-hero-sub">{handleLine}</div>
            <h1 className="page-hero-title">{creator.displayName}</h1>
            <p className="page-hero-desc">Katalog kreator resmi C.Verse.</p>
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">Creator Stats</span>
          <div className="ticker-track">
            <div className="ticker-scroll">
              {tickerItems.map((item) => (
                <span className="ticker-item" key={`${item.key}-a`}>
                  <span className="tk-key">{item.key}</span>
                  <span className={`tk-val ${item.accent}`}>{item.value}</span>
                  <span className="tk-sep" aria-hidden="true" />
                </span>
              ))}
              {tickerItems.map((item) => (
                <span className="ticker-item" key={`${item.key}-b`}>
                  <span className="tk-key">{item.key}</span>
                  <span className={`tk-val ${item.accent}`}>{item.value}</span>
                  <span className="tk-sep" aria-hidden="true" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card card-pad cp-operator" aria-label="Identitas kreator">
        <div className="cp-operator-row">
          <div className="cp-sigil" aria-hidden="true">
            <span className="cp-sigil-letter">{sigil}</span>
            <span className="cp-sigil-sheen" aria-hidden="true" />
          </div>
          <div className="cp-operator-meta">
            <span className="eyebrow cp-eyebrow">KREATOR</span>
            <h2 className="h2 cp-name">{creator.displayName}</h2>
            <div className="mono cp-handle">{handleLine}</div>
          </div>
        </div>
        <div className="cp-stats" role="list" aria-label="Statistik kreator">
          <div className="cp-stat" role="listitem">
            <span className="cp-stat-label">RILISAN</span>
            <span className="cp-stat-value">{drops.length}</span>
          </div>
          <div className="cp-stat" role="listitem">
            <span className="cp-stat-label">TOP KOLEKTOR</span>
            <span className="cp-stat-value">{board.length}</span>
          </div>
          <div className="cp-stat" role="listitem">
            <span className="cp-stat-label">LIVE</span>
            <span className="cp-stat-value">{drops.filter((d) => d.status === "live").length}</span>
          </div>
        </div>
      </section>

      <section className="cp-drops-section" aria-label="Rilisan kreator">
        <header className="section-head">
          <span className="section-eyebrow">RILISAN</span>
          <span className="section-count">{drops.length}</span>
          <span className="section-rule" aria-hidden="true" />
          <h2 className="section-title">Katalog Drop</h2>
        </header>

        {drops.length === 0 ? (
          <div className="empty-arcade cp-empty" role="status">
            <div className="empty-icon" aria-hidden="true">
              EMPTY
            </div>
            <div className="empty-title">Belum ada rilisan</div>
            <p className="empty-msg">Kreator ini belum memublikasikan drop apa pun.</p>
          </div>
        ) : (
          <div className="grid-3 cp-grid">
            {drops.map((d) => {
              const isLive = d.status === "live";
              const init = thumbSigil(d.title, d.series);
              return (
                <Link key={d.id} to={`/drops/${d.id}`} className="card cp-tile" aria-label={`Detail drop ${d.title}`}>
                  <div className="cp-thumb">
                    <span className="cp-thumb-sigil" aria-hidden="true">
                      {init}
                    </span>
                    <span className="cp-thumb-sheen" aria-hidden="true" />
                    <span className="cp-status-chip">
                      <StatusBadge status={d.status} kind="drop" pulse={isLive} />
                    </span>
                    <span className="cp-rank-chip mono" aria-label={`Series ${d.series}`}>
                      {d.series?.slice(0, 6).toUpperCase() ?? "DROP"}
                    </span>
                  </div>
                  <div className="cp-tile-body">
                    <div className="cp-tile-title">{d.title}</div>
                    <div className="mono cp-tile-meta">
                      <span>{d.series || "C.Card"}</span>
                      <span className="cp-tile-meta-sep">·</span>
                      <span>{d.status.toUpperCase()}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="cp-board-section" aria-label="Papan Kolektor Kreator">
        <header className="section-head">
          <span className="section-eyebrow">PAPAN KOLEKTOR</span>
          <span className="section-count">{board.length}</span>
          <span className="section-rule" aria-hidden="true" />
          <h2 className="section-title">Top 10 Kolektor</h2>
        </header>

        {boardLoading ? (
          <LoadingState label="Memuat papan kolektor…" />
        ) : boardError ? (
          <ErrorState onRetry={() => void refetchBoard()} label="Gagal memuat papan kolektor" />
        ) : board.length === 0 ? (
          <div className="cp-empty-soft" role="status">
            Belum ada kolektor tercatat untuk kreator ini.
          </div>
        ) : (
          <div className="lb-list cp-board" aria-label="Daftar kolektor kreator">
            {board.map((e) => {
              const tier = tierOf(e.tier);
              return (
                <Link
                  key={e.userId}
                  to={`/u/${e.username ?? e.userId}`}
                  className={`lb-row tier-${tier}`}
                  aria-label={`Peringkat ${e.rank}: ${e.displayName}`}
                >
                  <span className="lb-rank">{String(e.rank).padStart(2, "0")}</span>
                  <span className="lb-player">
                    <span className="lb-avatar" aria-hidden="true">
                      {getSigil(e.displayName, e.username)}
                    </span>
                    <span className="lb-player-meta">
                      <span className="lb-player-name">{e.displayName}</span>
                      {e.username && <span className="lb-player-handle">@{e.username}</span>}
                    </span>
                  </span>
                  <span className="lb-tier" aria-label={`Tier ${tier}`}>
                    <span className="mono">{tier.toUpperCase()}</span>
                  </span>
                  <span className="lb-level">
                    {e.level}
                    <span className="lb-level-of">LV</span>
                  </span>
                  <span className="lb-cards">
                    {e.score.toLocaleString("id-ID")}
                    <span className="lb-cards-label">kartu</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
