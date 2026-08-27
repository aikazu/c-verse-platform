import type { UserBadge as SharedUserBadge } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { LevelBar } from "../components/LevelBar";
import { ApiError, api } from "../lib/api";
import type { ApiPublicProfileCard, ApiPublicProfileResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import "./profile.css";

// Operator-channel for sibling-lane collision check: CH:05 / PROFIL
// (existing: Drops CH:01, Marketplace CH:02, Browse CH:03, Leaderboard CH:04).
const CHANNEL = "CH:05 / PROFIL";
const CHANNEL_EXTRA = "PILOT DOSSIER";

function getSigil(displayName: string, username: string | null | undefined): string {
  const source = displayName?.trim() || username?.trim() || "?";
  const cleaned = source.replace(/^@+/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

export default function PublicProfile() {
  const { username } = useParams();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ApiPublicProfileResponse>({
    queryKey: ["public-profile", username],
    queryFn: () => api.publicProfile(username!),
    enabled: !!username,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 1;
    },
  });

  const notFound = isError && error instanceof ApiError && error.status === 404;

  if (isLoading) {
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil publik">
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
              <h1 className="page-hero-title">Memuat profil…</h1>
              <p className="page-hero-desc">Menghubungkan ke konsol kolektor C.Verse.</p>
            </div>
          </div>
        </section>
        <LoadingState label="Memuat profil…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil publik">
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
              <h1 className="page-hero-title">Pilot tidak ditemukan</h1>
              <p className="page-hero-desc">Handle yang diminta tidak ada di katalog kolektor publik.</p>
            </div>
          </div>
        </section>
        <div className="empty-arcade pp-empty" role="status">
          <div className="empty-icon" aria-hidden="true">
            404
          </div>
          <div className="empty-title">Profil tidak ditemukan</div>
          <p className="empty-msg">Handle @{username ?? "—"} belum terdaftar atau sudah dihapus dari katalog publik.</p>
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
        <section className="page-hero" aria-label="Profil publik">
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
              <h1 className="page-hero-title">Gagal memuat profil</h1>
              <p className="page-hero-desc">Konsol tidak dapat menghubungi server. Coba ulangi sebentar lagi.</p>
            </div>
          </div>
        </section>
        <ErrorState onRetry={() => void refetch()} label="Gagal memuat profil publik" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-stack">
        <ErrorState onRetry={() => void refetch()} label="Profil tidak ditemukan" />
      </div>
    );
  }

  if (data.hidden) {
    // Privacy invariant: hidden profile never reveals displayName / collection / level / badges.
    const handleOnly = data.user?.username ? `@${data.user.username}` : `@${username ?? ""}`;
    return (
      <div className="page-stack">
        <section className="page-hero" aria-label="Profil publik">
          <div className="page-hero-rail">
            <span className="rail-channel">{CHANNEL}</span>
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-sep">·</span>
            <span className="rail-extra">PRIVATE DOSSIER</span>
            <span className="rail-time" aria-label="Tersembunyi">
              <span className="rail-cursor" aria-hidden="true" />
            </span>
          </div>
          <div className="page-hero-inner">
            <div className="page-hero-copy">
              <div className="page-hero-sub">{handleOnly}</div>
              <h1 className="page-hero-title">Profil disembunyikan</h1>
              <p className="page-hero-desc">Pemilik memilih untuk menutup berkas publiknya.</p>
            </div>
          </div>
        </section>
        <div className="empty-arcade pp-empty" role="status">
          <div className="empty-icon pp-hidden-icon" aria-hidden="true">
            ◌
          </div>
          <div className="empty-title">Profil disembunyikan</div>
          <p className="empty-msg">Pemilik menyembunyikan profil dari publik.</p>
          <div className="pp-hidden-handle mono" aria-label="Handle yang diminta">
            {handleOnly}
          </div>
        </div>
      </div>
    );
  }

  const user = data.user;
  const cards: ApiPublicProfileCard[] = data.cards ?? [];
  const badges: SharedUserBadge[] = data.badges ?? [];
  const tier = user.tier ?? "bronze";
  const level = user.level ?? 1;
  const pct = user.levelProgressPct ?? 0;
  const rank = user.rank;
  const sigil = getSigil(user.displayName, user.username);
  const handle = user.username ? `@${user.username}` : `@${username ?? ""}`;

  const tickerItems = [
    { key: "RANK", value: rank !== undefined ? `#${rank}` : "—", accent: "gold" as const },
    { key: "C.CARD", value: `${cards.length}`, accent: "cyan" as const },
    { key: "LENCANA", value: `${badges.length}`, accent: "magenta" as const },
    { key: "TIER", value: tier.toUpperCase(), accent: "signal" as const },
  ];

  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Profil publik">
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
            <div className="page-hero-sub">{handle}</div>
            <h1 className="page-hero-title">{user.displayName}</h1>
            <p className="page-hero-desc">Berkas kolektor resmi C.Verse.</p>
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">Pilot Stats</span>
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

      <section className="card card-pad pp-operator" aria-label="Identitas operator">
        <div className="pp-operator-row">
          <div className="pp-sigil" aria-hidden="true">
            <span className="pp-sigil-letter">{sigil}</span>
            <span className="pp-sigil-sheen" aria-hidden="true" />
          </div>
          <div className="pp-operator-meta">
            <span className="eyebrow pp-eyebrow">KOLEKTOR</span>
            <h2 className="h2 pp-name">{user.displayName}</h2>
            <div className="mono pp-handle">{handle}</div>
            <div className="pp-chips">
              <span className={`tier-${tier} pp-tier-chip`} aria-label={`Tier ${tier}`}>
                <span className="mono">{tier.toUpperCase()}</span>
              </span>
              {user.role === "creator" && <span className="pill pill-info pp-role-chip">KREATOR</span>}
              {user.role === "admin" && <span className="pill pill-warn pp-role-chip">ADMIN</span>}
              {user.isAnonymous && <span className="pill pill-muted pp-role-chip">ANONIM</span>}
            </div>
          </div>
        </div>
        <div className="pp-levelbar">
          <LevelBar level={level} tier={tier} pct={pct} compact />
        </div>
        <div className="pp-stats" role="list" aria-label="Statistik kolektor">
          <div className="pp-stat" role="listitem">
            <span className="pp-stat-label">RANK</span>
            <span className="pp-stat-value">{rank !== undefined ? `#${rank}` : "—"}</span>
          </div>
          <div className="pp-stat" role="listitem">
            <span className="pp-stat-label">C.CARD</span>
            <span className="pp-stat-value">{cards.length}</span>
          </div>
          <div className="pp-stat" role="listitem">
            <span className="pp-stat-label">LENCANA</span>
            <span className="pp-stat-value">{badges.length}</span>
          </div>
        </div>
        {badges.length > 0 && (
          <div className="pp-badges" aria-label="Lencana kolektor">
            {badges.map((ub: SharedUserBadge) => (
              <span key={ub.badgeId} className="pill pill-warn pp-badge">
                {ub.badge?.icon ? `${ub.badge.icon} ` : ""}
                {ub.badge?.name ?? ub.badgeId}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="pp-collection-section" aria-label="Koleksi C.Card">
        <header className="section-head">
          <span className="section-eyebrow">KOLEKSI</span>
          <span className="section-count">{cards.length} C.CARD</span>
          <span className="section-rule" aria-hidden="true" />
          <h2 className="section-title">Unit Terdaftar</h2>
        </header>

        {cards.length === 0 ? (
          <div className="empty-arcade pp-empty" role="status">
            <div className="empty-icon" aria-hidden="true">
              EMPTY
            </div>
            <div className="empty-title">Belum ada C.Card</div>
            <p className="empty-msg">Kolektor ini belum mendaftarkan unit publik apa pun.</p>
          </div>
        ) : (
          <div className="grid-3 pp-grid">
            {cards.map((c) => {
              // Title fallback chain must NEVER reach an identifier (dropId/cardId)
              // — a zero-padded UUID prefix would leak into the UI. Derive a
              // displayable label from real payload (drop.title → unit label) or
              // fall back to a neutral placeholder.
              const dropTitle = c.drop?.title;
              const title = dropTitle
                ? dropTitle
                : c.unitNumber !== undefined && c.unitNumber !== null
                  ? `C.Card #${c.unitNumber}`
                  : "C.Card";
              const series = c.drop?.series ?? "";
              const init = getSigil(title, series);
              return (
                <Link
                  key={c.id}
                  to={`/cards/${c.id}`}
                  className="card pp-tile"
                  aria-label={`Lihat C.Card ${title} unit ${c.unitNumber ?? "?"}`}
                >
                  <div className="pp-thumb">
                    <span className="pp-thumb-sigil" aria-hidden="true">
                      {init}
                    </span>
                    <span className="pp-thumb-sheen" aria-hidden="true" />
                    <span className="pp-rank-chip mono" aria-label={`Unit ${c.unitNumber ?? "?"}`}>
                      #{c.unitNumber ?? "?"}
                    </span>
                  </div>
                  <div className="pp-tile-body">
                    <div className="pp-tile-title">{title}</div>
                    <div className="mono pp-tile-meta">
                      {series ? <span>{series}</span> : <span>C.Card</span>}
                      {c.unitNumber !== undefined && c.unitNumber !== null ? <span className="pp-tile-meta-sep">·</span> : null}
                      {c.unitNumber !== undefined && c.unitNumber !== null ? <span>UNIT #{c.unitNumber}</span> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
