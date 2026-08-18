import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { LevelBar } from "../components/LevelBar";
import { api } from "../lib/api";

export default function PublicProfile() {
  const { username } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["public-profile", username],
    queryFn: () => api.publicProfile(username!),
    enabled: !!username,
  });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <p className="muted">Profil tidak ditemukan</p>
      </div>
    );
  const d: any = data as any;
  if (d.hidden) {
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.6 }}>◯</div>
        <div style={{ fontWeight: 600 }}>Profil disembunyikan</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Pemilik menyembunyikan profil
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          {d.user?.username ? `@${d.user.username}` : d.user?.displayName}
        </div>
      </div>
    );
  }
  const user = d.user;
  const cards: any[] = d.cards ?? [];
  const badges: any[] = d.badges ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card card-pad">
        <span className="eyebrow">Profil</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          {user.username ? `@${user.username} — ` : ""}
          {user.displayName}
        </h1>
        <LevelBar level={user.level} tier={user.tier} pct={user.levelProgressPct ?? 0} compact />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
          #{user.rank} · {cards.length} C.Card · {badges.length} lencana
        </div>
        {badges.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {badges.map((ub: any) => (
              <span key={ub.badgeId} className="pill pill-warn" style={{ fontSize: 11 }}>
                {ub.badge?.icon} {ub.badge?.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 24, fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Belum ada C.Card
        </div>
      ) : (
        <div className="grid-3">
          {cards.map((c: any) => (
            <Link
              key={c.id}
              to={`/cards/${c.id}`}
              className="card"
              style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  height: 120,
                  background: "var(--thumb-grad)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                }}
              >
                🎴
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>
                  {c.drop?.title ?? c.dropId} · #{c.unitNumber}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{c.drop?.series}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
