import type { Badge, LeaderboardEntry, LeaderboardType } from "@c-verse/shared";
import { LEVEL_TIERS, type LevelTier } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiBadgesResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

// Tier validator over the 10-value Galactic Rank Ladder (single source: shared).
// Anything outside the ladder falls back to `orbit` so an unrecognised server
// string never crashes the chip. Note: `podiumClassByRank` below uses
// gold/silver/bronze literally as 1st/2nd/3rd RANK classes — those are NOT
// level tiers and are deliberately kept separate from this ladder.
const VALID_TIERS = new Set<LevelTier>(LEVEL_TIERS);

function tierOf(s: string): LevelTier {
  return (VALID_TIERS.has(s as LevelTier) ? s : "orbit") as LevelTier;
}

function tierClass(t: LevelTier): string {
  return `tier-${t}`;
}

function avatarInitial(name: string | null | undefined): string {
  if (name && name.length > 0) return name.slice(0, 1).toUpperCase();
  return "◆";
}

function medalLabel(rank: number): string {
  if (rank === 1) return "Juara 1";
  if (rank === 2) return "Juara 2";
  if (rank === 3) return "Juara 3";
  return `Peringkat ${rank}`;
}

// Lane P2: payload leaderboard tidak lagi membawa userId (UUID tidak keluar dari
// server) — key papan memakai rank (unik per board) dan link profil hanya saat
// username tersedia (fallback UUID dihapus, bukan diganti).
function profileTarget(e: LeaderboardEntry): string | null {
  return e.username ? `/u/${e.username}` : null;
}

// Tab labels are UI-only; keep the URL query as the canonical machine value
// so deep-links round-trip and React Query keys are deterministic.
const TABS: ReadonlyArray<{ value: LeaderboardType; label: string }> = [
  { value: "xp", label: "Level" },
  { value: "cards", label: "Kolektor" },
  { value: "badges", label: "Lencana" },
];

const VALID_TAB_VALUES = new Set<LeaderboardType>(TABS.map((t) => t.value));

function parseTab(raw: string | null): LeaderboardType {
  if (raw && (VALID_TAB_VALUES as Set<string>).has(raw)) return raw as LeaderboardType;
  return "xp";
}

export default function Leaderboard() {
  // URL state keeps the active board shareable + back/forward-friendly.
  // react-router-dom v7 supports useSearchParams out of the box.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType: LeaderboardType = parseTab(searchParams.get("tab"));

  const setActiveType = (next: LeaderboardType) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "xp") sp.delete("tab");
    else sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  };

  // Query key includes `type` so switching tabs refetches without colliding
  // with previous cache entries (no flash of stale standings).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["leaderboard", activeType],
    queryFn: () => api.leaderboard({ type: activeType, limit: 50 }),
  });
  const { data: badgesData } = useQuery<ApiBadgesResponse>({
    queryKey: ["badges"],
    queryFn: () => api.badges(),
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat peringkat" />;

  const board: LeaderboardEntry[] = data?.leaderboard ?? [];
  const badges: Badge[] = badgesData?.badges ?? [];

  // Tier coloring is only meaningful on the XP/Level board — on Kolektor or
  // Lencana the tier still reflects the player's XP level, but painting it
  // as a "ranking color" would falsely claim those collectors achieved that
  // tier on this board. We suppress the tier chip + the per-row tier class
  // for non-XP boards; podium medal class (gold/silver/bronze) stays since
  // it's the literal 1st/2nd/3rd podium, not a level-tier claim.
  const showTierChip = activeType === "xp";

  // Score semantics per board (server is source of truth — we only LABEL).
  const scoreLabel = activeType === "xp" ? "XP" : activeType === "cards" ? "C.Card" : activeType === "badges" ? "Lencana" : "Skor";

  const tickerChips = (() => {
    if (board.length === 0) return null;
    if (activeType === "xp") {
      // Honest: only derived from the rows we actually have. The board is
      // ranked by totalXp/level, so we highlight the leader's XP and level
      // plus the roster size — nothing fabricated beyond the rows shown.
      const topXp = board[0]?.totalXp ?? 0;
      const topLevel = board[0]?.level ?? 0;
      // Di papan xp `score` adalah XP, bukan jumlah kartu — total "C.Card
      // Top 50" sengaja tidak ditampilkan daripada memfabrikasi angka
      // (menjumlahkan `score` akan menjumlahkan XP).
      return [
        { key: "LV TERTINGGI", value: String(topLevel) },
        { key: "XP TERTINGGI", value: topXp.toLocaleString("id-ID") },
        { key: "PEMAIN", value: String(board.length) },
      ];
    }
    if (activeType === "cards") {
      const topCards = board[0]?.score ?? 0;
      return [
        { key: "KOLEKSI TERBANYAK", value: `${topCards.toLocaleString("id-ID")} C.Card` },
        { key: "KOLEKTOR", value: String(board.length) },
      ];
    }
    // badges
    const topBadges = board[0]?.score ?? 0;
    return [
      { key: "LENCANA TERBANYAK", value: `${topBadges} lencana` },
      { key: "KOLEKTOR", value: String(board.length) },
    ];
  })();

  const topThree = board.slice(0, 3);
  // DOM order = rank order (1, 2, 3) so mobile stacks correctly.
  // CSS uses `order` property to reposition on desktop into podium visual (2 / 1 / 3).
  const podiumClassByRank: Record<number, "gold" | "silver" | "bronze"> = { 1: "gold", 2: "silver", 3: "bronze" };

  const rest = board.slice(3);
  const totalPlayers = board.length;

  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Peringkat">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:04 / RANK</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">SYNCING STANDINGS</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">Peringkat</h1>
          </div>
        </div>

        <div className="lb-tabs" role="tablist" aria-label="Papan peringkat">
          {TABS.map((t) => {
            const isActive = t.value === activeType;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`lb-tab${isActive ? " is-active" : ""}`}
                onClick={() => setActiveType(t.value)}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">{TABS.find((t) => t.value === activeType)?.label ?? "Top 10"}</span>
          <div className="ticker-track">
            <div className="ticker-scroll">
              {board.slice(0, 10).map((e, i) => (
                <span key={`a-${e.rank}`} className="ticker-item">
                  <span className="tk-key">#{String(i + 1).padStart(2, "0")}</span>
                  <span className="tk-val ticker-name">{e.displayName}</span>
                  <span className="tk-key">{scoreLabel}</span>
                  <span className="tk-val cyan">
                    {activeType === "xp" ? e.totalXp.toLocaleString("id-ID") : e.score.toLocaleString("id-ID")}
                  </span>
                </span>
              ))}
              {board.length > 0 && (
                <span className="ticker-item">
                  <span className="tk-sep" aria-hidden="true" />
                </span>
              )}
              {tickerChips?.map((chip) => (
                <span key={`chip-${chip.key}`} className="ticker-item">
                  <span className="tk-key">{chip.key}</span>
                  <span className="tk-val">{chip.value}</span>
                  <span className="tk-sep" aria-hidden="true" />
                </span>
              ))}
              <span className="ticker-item">
                <span className="tk-key">PEMAIN</span>
                <span className="tk-val cyan">{totalPlayers}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              {/* duplicate for seamless marquee loop */}
              {board.slice(0, 10).map((e, i) => (
                <span key={`b-${e.rank}`} className="ticker-item">
                  <span className="tk-key">#{String(i + 1).padStart(2, "0")}</span>
                  <span className="tk-val ticker-name">{e.displayName}</span>
                  <span className="tk-key">{scoreLabel}</span>
                  <span className="tk-val cyan">
                    {activeType === "xp" ? e.totalXp.toLocaleString("id-ID") : e.score.toLocaleString("id-ID")}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {board.length === 0 ? (
        <div className="empty-arcade">
          <div className="empty-icon" aria-hidden="true">
            NO_PLAYERS
          </div>
          <div className="empty-title">Belum ada kolektor di papan ini</div>
          <p className="empty-msg">
            {activeType === "xp"
              ? "Papan Level akan terisi setelah kolektor mulai menambah XP dari pembelian C.Card."
              : activeType === "cards"
                ? "Papan Kolektor akan terisi setelah kolektor memiliki C.Card."
                : "Papan Lencana akan terisi setelah kolektor mendapatkan lencana pertama mereka."}
          </p>
        </div>
      ) : (
        <>
          {topThree.length > 0 && (
            <section className="podium" aria-label="Podium top 3 kolektor">
              {topThree.map((e) => {
                const tier = tierOf(e.tier);
                const target = profileTarget(e);
                const className = `podium-spot ${podiumClassByRank[e.rank] ?? ""} ${showTierChip ? tierClass(tier) : ""}`;
                const label = `Peringkat ${e.rank}: ${e.displayName}`;
                const inner = (
                  <>
                    <div className="podium-rank" aria-hidden="true">
                      {e.rank === 1 ? "01" : e.rank === 2 ? "02" : "03"}
                    </div>
                    <div className="podium-medal">{medalLabel(e.rank)}</div>
                    <div className="podium-avatar" aria-hidden="true">
                      {avatarInitial(e.displayName)}
                    </div>
                    <span className="podium-name">{e.displayName}</span>
                    {e.username && <span className="podium-handle">@{e.username}</span>}
                    {showTierChip && <span className="podium-tier">{tier}</span>}
                    <div className="podium-stats">
                      <div>
                        <div className="podium-stat-val">{e.level}</div>
                        <div className="podium-stat-key">Level</div>
                      </div>
                      <div>
                        <div className="podium-stat-val cyan">{e.score.toLocaleString("id-ID")}</div>
                        <div className="podium-stat-key">{scoreLabel}</div>
                      </div>
                    </div>
                  </>
                );
                return target ? (
                  <Link key={e.rank} to={target} data-rank={e.rank} className={className} aria-label={label}>
                    {inner}
                  </Link>
                ) : (
                  <div key={e.rank} data-rank={e.rank} className={className} aria-label={label}>
                    {inner}
                  </div>
                );
              })}
            </section>
          )}

          {rest.length > 0 && (
            <section className="lb-list" aria-label="Daftar peringkat kolektor">
              {rest.map((e) => {
                const tier = tierOf(e.tier);
                const target = profileTarget(e);
                const className = `lb-row ${showTierChip ? tierClass(tier) : ""}`;
                const label = `Peringkat ${e.rank}: ${e.displayName}`;
                const inner = (
                  <>
                    <span className="lb-rank">{String(e.rank).padStart(2, "0")}</span>
                    <span className="lb-player">
                      <span className="lb-avatar" aria-hidden="true">
                        {avatarInitial(e.displayName)}
                      </span>
                      <span className="lb-player-meta">
                        <span className="lb-player-name">{e.displayName}</span>
                        {e.username && <span className="lb-player-handle">@{e.username}</span>}
                      </span>
                    </span>
                    {showTierChip && <span className="lb-tier">{tier}</span>}
                    <span className="lb-level">
                      {e.level}
                      <span className="lb-level-of">LV</span>
                    </span>
                    <span className="lb-cards">
                      {e.score.toLocaleString("id-ID")}
                      <span className="lb-cards-label">{scoreLabel}</span>
                    </span>
                  </>
                );
                return target ? (
                  <Link key={e.rank} to={target} className={className} aria-label={label}>
                    {inner}
                  </Link>
                ) : (
                  <div key={e.rank} className={className} aria-label={label}>
                    {inner}
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {badges.length > 0 && (
        <section aria-label="Galeri lencana">
          <div className="section-head">
            <span className="section-eyebrow">LENCANA</span>
            <span className="section-count">{badges.length}</span>
            <span className="section-rule" aria-hidden="true" />
          </div>
          <div className="badge-rail">
            {badges.map((b) => {
              const xpValue = b.xpReward ?? b.xp;
              return (
                <article key={b.id} className="badge-tile" title={b.description}>
                  <div className="tile-icon" aria-hidden="true">
                    {b.icon || "✦"}
                  </div>
                  <div className="tile-name">{b.name}</div>
                  <div className="tile-desc">{b.description}</div>
                  {xpValue ? <div className="tile-xp">{xpValue} XP</div> : null}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
