import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Leaderboard() {
  const { data, isLoading } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api.leaderboard(20) });
  const { data: badgesData } = useQuery({ queryKey: ["badges"], queryFn: () => api.badges() });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  const board: any[] = (data as any)?.leaderboard ?? [];
  const badges: any[] = (badgesData as any)?.badges ?? [];
  const tierStyle: Record<string, { bg: string; color: string }> = {
    bronze: { bg: "rgba(205,127,50,0.14)", color: "#d4a574" },
    silver: { bg: "rgba(148,163,184,0.14)", color: "#cbd5e1" },
    gold: { bg: "rgba(201,163,82,0.18)", color: "#E0BF6B" },
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
                <th>Kartu</th>
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
                board.map((e: any) => {
                  const href = e.username ? `/u/${e.username}` : `/u/${e.userId}`;
                  const t = tierStyle[e.tier] ?? tierStyle.bronze;
                  return (
                    <tr key={e.userId} style={e.rank <= 3 ? { background: "rgba(201,163,82,0.04)" } : {}}>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>
                        {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : String(e.rank).padStart(2, "0")}
                      </td>
                      <td>
                        <Link to={href} style={{ fontWeight: 600, color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
                          {e.displayName}
                        </Link>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                          {" "}
                          · {e.username ? `@${e.username}` : e.userId.slice(0, 8)}
                        </span>
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
            {badges.map((b: any) => (
              <span key={b.id} className="pill pill-warn" title={b.description} style={{ padding: "7px 12px", fontSize: 12 }}>
                {b.icon ?? b.icon_url} {b.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
