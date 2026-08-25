import type { Badge } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiBadgesResponse, ApiLeaderboardEntry } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

export default function Leaderboard() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api.leaderboard(20) });
  const { data: badgesData } = useQuery<ApiBadgesResponse>({ queryKey: ["badges"], queryFn: () => api.badges() });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat peringkat" />;
  const board: ApiLeaderboardEntry[] = data?.leaderboard ?? [];
  const badges: Badge[] = badgesData?.badges ?? [];
  const tierStyle: Record<string, { bg: string; color: string }> = {
    bronze: { bg: "rgba(205,127,50,0.14)", color: "#d4a574" },
    silver: { bg: "rgba(148,163,184,0.14)", color: "#cbd5e1" },
    gold: { bg: "var(--gold-bg)", color: "#E0BF6B" },
    platinum: { bg: "rgba(125,211,252,0.14)", color: "#7dd3fc" },
    diamond: { bg: "rgba(165,180,252,0.14)", color: "#a5b4fc" },
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <span className="eyebrow">Komunitas</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Peringkat
        </h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Berdasarkan aktivitas koleksi
        </p>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Kolektor</th>
                <th>Tier</th>
                <th>Level</th>
                <th>C.Card</th>
              </tr>
            </thead>
            <tbody>
              {board.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24 }} className="muted">
                    Belum ada data
                  </td>
                </tr>
              ) : (
                board.map((e) => {
                  const href = `/u/${e.username ?? e.userId}`;
                  const t = tierStyle[e.tier] ?? tierStyle.bronze;
                  return (
                    <tr key={e.userId} style={e.rank <= 3 ? { background: "var(--gold-bg-soft)" } : {}}>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>
                        {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : String(e.rank).padStart(2, "0")}
                      </td>
                      <td>
                        <Link to={href} style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
                          {e.displayName}
                        </Link>
                        {e.username && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}> · @{e.username}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="pill"
                          style={{
                            background: t.bg,
                            color: t.color,
                            border: `1px solid ${t.color}30`,
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {e.tier}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>Lv {e.level}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{e.totalCards}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {badges.length > 0 && (
        <div className="card card-pad">
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              marginBottom: 12,
            }}
          >
            Lencana — {badges.length}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {badges.map((b) => (
              <span key={b.id} className="pill pill-warn" title={b.description} style={{ padding: "7px 12px", fontSize: 12 }}>
                {b.icon} {b.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
