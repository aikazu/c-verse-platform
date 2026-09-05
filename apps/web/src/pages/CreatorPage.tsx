import type { LeaderboardEntry, LevelTier } from "@c-verse/shared";
import { LEVEL_TIERS } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { LEGAL_CONSENTS } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import { StatusBadge } from "../components/StatusBadge";
import { trackCreatorPageView } from "../lib/analytics";
import { ApiError, api } from "../lib/api";
import type { ApiCreatorPublicResponse, ApiDrop, ApiLeaderboardResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./creator.css";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Tier validator over the 10-value Galactic Rank Ladder (single source: shared).
// Unrecognised server strings fall back to `orbit` (lowest band).
const VALID_TIERS = new Set<LevelTier>(LEVEL_TIERS);
function tierOf(s: string): LevelTier {
  return (VALID_TIERS.has(s as LevelTier) ? s : "orbit") as LevelTier;
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
  const { user } = useAuth();
  const { push } = useToast();
  const confirm = useConfirm();
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportAmount, setSupportAmount] = useState("");
  const [busySupport, setBusySupport] = useState(false);
  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchCreator,
  } = useQuery<ApiCreatorPublicResponse>({
    queryKey: ["creator-pub", username],
    queryFn: () => api.creatorPublic(username!),
    enabled: !!username,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 1;
    },
  });

  // URLs also accept creator handles and user IDs; the beacon RPC uses usernames.
  const creatorUsername = data?.creator.username;
  useEffect(() => {
    if (creatorUsername) trackCreatorPageView(creatorUsername);
  }, [creatorUsername]);

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
        <PageHero channel="06A" channelLabel="KREATOR" title="Memuat kreator…" sub={`@${username ?? "—"}`} desc="Memuat profil kreator…" />
        <LoadingState label="Memuat kreator…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-stack">
        <PageHero
          channel="06A"
          channelLabel="KREATOR"
          title="Kreator tidak ditemukan"
          sub={`@${username ?? "—"}`}
          desc="Handle yang diminta tidak ada di katalog kreator publik."
        />
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
        <PageHero channel="06A" channelLabel="KREATOR" title="Gagal memuat kreator" desc="Profil kreator belum dapat dimuat." />
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
  // Response shape: drops is a sibling of `creator` (GET /api/creators/:id).
  const drops: ApiDrop[] = data.drops ?? [];
  // doc 02 PG-CRT-PUB-01 hanya handle + drop list (tanpa follower count, tanpa bio / links
  // — API tidak mengembalikan field tersebut saat ini).
  const handle = creator.handle ?? creator.username ?? null;

  // creator.id is the owner userId (creators.ts:115/129) — support is hidden on the
  // creator's own page and for anonymous visitors (same gating as CardInfo buyout).
  const canSupport = !!user && creator.id !== user.id;

  async function onSupport() {
    const amt = Number(supportAmount);
    if (!Number.isInteger(amt) || amt < 1) {
      push("Minimal 1 C-Coin", "info");
      return;
    }
    // Spend action — mandatory in-app confirm (founder 2026-08-29).
    if (
      !(await confirm({
        title: `Kirim dukungan ${amt} C?`,
        confirmLabel: "Kirim",
        requireCheck: LEGAL_CONSENTS.support,
      }))
    )
      return;
    setBusySupport(true);
    try {
      await api.supportCreator(creator.id, amt);
      push(`Dukungan ${amt} C terkirim`, "success");
      setSupportOpen(false);
      setSupportAmount("");
    } catch (e) {
      // Server business errors (INSUFFICIENT dll) already arrive as user-facing
      // Indonesian messages — surface them as-is.
      push(errorMessage(e), "error");
    } finally {
      setBusySupport(false);
    }
  }

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
      value: drops.some((d) => d.status === "live") ? "AKTIF" : "BELUM ADA",
      accent: drops.some((d) => d.status === "live") ? ("signal" as const) : ("muted" as const),
    },
  ];

  const heroTicker = (
    <div className="hero-ticker" aria-hidden="true">
      <span className="ticker-label">Kreator</span>
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
  );

  return (
    <div className="page-stack">
      <PageHero channel="06A" channelLabel="KREATOR" title={creator.displayName} sub={handleLine} ticker={heroTicker} />

      <section className="card card-pad cp-operator" aria-label="Identitas kreator">
        <div className="cp-operator-row">
          <div className="cp-sigil" aria-hidden="true">
            <span className="cp-sigil-letter">{sigil}</span>
            <span className="cp-sigil-sheen" aria-hidden="true" />
          </div>
          <div className="cp-operator-meta">
            <div className="mono cp-handle">{handleLine}</div>
          </div>
          {canSupport && (
            <button className="btn-ghost cp-support-btn" onClick={() => setSupportOpen(true)}>
              Dukungan
            </button>
          )}
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
            <span className="cp-stat-label">AKTIF</span>
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
              // Lane P2: payload tanpa userId — link profil hanya via username.
              const className = `lb-row tier-${tier}`;
              const label = `Peringkat ${e.rank}: ${e.displayName}`;
              const inner = (
                <>
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
                    <span className="lb-cards-label">C.Card</span>
                  </span>
                </>
              );
              return e.username ? (
                <Link key={e.rank} to={`/u/${e.username}`} className={className} aria-label={label}>
                  {inner}
                </Link>
              ) : (
                <div key={e.rank} className={className} aria-label={label}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {supportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cp-support-title"
          className="cp-support-overlay"
          onClick={() => !busySupport && setSupportOpen(false)}
        >
          <div className="card card-pad cp-support-modal" onClick={(e) => e.stopPropagation()}>
            <div id="cp-support-title" className="cp-support-title">
              Dukungan untuk {creator.displayName}
            </div>
            <input
              className="input"
              type="number"
              min={1}
              aria-label="Jumlah dukungan C-Coin"
              placeholder="Jumlah C"
              value={supportAmount}
              onChange={(e) => setSupportAmount(e.target.value)}
              disabled={busySupport}
            />
            <div className="cp-support-actions">
              <button className="btn-ghost" onClick={() => setSupportOpen(false)} disabled={busySupport}>
                Batal
              </button>
              <button className="btn-gold" onClick={onSupport} disabled={busySupport || supportAmount === ""}>
                {busySupport ? "Memproses…" : "Kirim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
