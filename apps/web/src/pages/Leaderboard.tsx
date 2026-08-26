import type { Badge } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiBadgesResponse, ApiLeaderboardEntry } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

type Tier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

const VALID_TIERS = new Set<Tier>(["bronze", "silver", "gold", "platinum", "diamond"]);

function tierOf(s: string): Tier {
  return (VALID_TIERS.has(s as Tier) ? s : "bronze") as Tier;
}

function tierClass(t: Tier): string {
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

export default function Leaderboard() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api.leaderboard(50) });
  const { data: badgesData } = useQuery<ApiBadgesResponse>({ queryKey: ["badges"], queryFn: () => api.badges() });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat peringkat" />;
  const board: ApiLeaderboardEntry[] = data?.leaderboard ?? [];
  const badges: Badge[] = badgesData?.badges ?? [];

  const topThree = board.slice(0, 3);
  // DOM order = rank order (1, 2, 3) so mobile stacks correctly.
  // CSS uses `order` property to reposition on desktop into podium visual (2 / 1 / 3).
  const podiumClassByRank: Record<number, "gold" | "silver" | "bronze"> = { 1: "gold", 2: "silver", 3: "bronze" };

  const rest = board.slice(3);
  const totalPlayers = board.length;
  const topLevel = board.reduce((max, e) => Math.max(max, e.level ?? 0), 0);
  const totalCards = board.reduce((sum, e) => sum + (e.totalCards ?? 0), 0);
  const topPreview = board.slice(0, 10);

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
        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">Top 10</span>
          <div className="ticker-track">
            <div className="ticker-scroll">
              {topPreview.map((e, i) => (
                <span key={`a-${e.userId}`} className="ticker-item">
                  <span className="tk-key">#{String(i + 1).padStart(2, "0")}</span>
                  <span className="tk-val ticker-name">{e.displayName}</span>
                  <span className="tk-key">LV</span>
                  <span className="tk-val cyan">{e.level}</span>
                </span>
              ))}
              {topPreview.length > 0 && (
                <span className="ticker-item">
                  <span className="tk-sep" aria-hidden="true" />
                </span>
              )}
              <span className="ticker-item">
                <span className="tk-key">PEMAIN</span>
                <span className="tk-val cyan">{totalPlayers}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">LV TERTINGGI</span>
                <span className="tk-val">{topLevel}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">C.CARD TOP 50</span>
                <span className="tk-val magenta">{totalCards.toLocaleString("id-ID")}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              {/* duplicate for seamless marquee loop */}
              {topPreview.map((e, i) => (
                <span key={`b-${e.userId}`} className="ticker-item">
                  <span className="tk-key">#{String(i + 1).padStart(2, "0")}</span>
                  <span className="tk-val ticker-name">{e.displayName}</span>
                  <span className="tk-key">LV</span>
                  <span className="tk-val cyan">{e.level}</span>
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
          <div className="empty-title">Belum ada kolektor di peringkat</div>
          <p className="empty-msg">Peringkat akan terisi setelah kolektor mulai menambah C.Card di koleksi mereka.</p>
        </div>
      ) : (
        <>
          {topThree.length > 0 && (
            <section className="podium" aria-label="Podium top 3 kolektor">
              {topThree.map((e) => {
                const tier = tierOf(e.tier);
                return (
                  <Link
                    key={e.userId}
                    to={`/u/${e.username ?? e.userId}`}
                    data-rank={e.rank}
                    className={`podium-spot ${podiumClassByRank[e.rank] ?? ""} ${tierClass(tier)}`}
                    aria-label={`Peringkat ${e.rank}: ${e.displayName}`}
                  >
                    <div className="podium-rank" aria-hidden="true">
                      {e.rank === 1 ? "01" : e.rank === 2 ? "02" : "03"}
                    </div>
                    <div className="podium-medal">{medalLabel(e.rank)}</div>
                    <div className="podium-avatar" aria-hidden="true">
                      {avatarInitial(e.displayName)}
                    </div>
                    <span className="podium-name">{e.displayName}</span>
                    {e.username && <span className="podium-handle">@{e.username}</span>}
                    <span className="podium-tier">{tier}</span>
                    <div className="podium-stats">
                      <div>
                        <div className="podium-stat-val">{e.level}</div>
                        <div className="podium-stat-key">Level</div>
                      </div>
                      <div>
                        <div className="podium-stat-val cyan">{e.totalCards}</div>
                        <div className="podium-stat-key">C.Card</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </section>
          )}

          {rest.length > 0 && (
            <section className="lb-list" aria-label="Daftar peringkat kolektor">
              {rest.map((e) => {
                const tier = tierOf(e.tier);
                return (
                  <Link
                    key={e.userId}
                    to={`/u/${e.username ?? e.userId}`}
                    className={`lb-row ${tierClass(tier)}`}
                    aria-label={`Peringkat ${e.rank}: ${e.displayName}`}
                  >
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
                    <span className="lb-tier">{tier}</span>
                    <span className="lb-level">
                      {e.level}
                      <span className="lb-level-of">LV</span>
                    </span>
                    <span className="lb-cards">
                      {e.totalCards}
                      <span className="lb-cards-label">card</span>
                    </span>
                  </Link>
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
