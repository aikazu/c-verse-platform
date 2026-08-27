import type { UserBadge as SharedUserBadge } from "@c-verse/shared";
import { cardLocationLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { LevelBar } from "../components/LevelBar";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";

export default function Collection() {
  return (
    <RequireAuth>
      <CollectionInner />
    </RequireAuth>
  );
}

function CollectionInner() {
  const { user } = useAuth();
  const { data, refetch, isLoading, isError } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.profile(),
    enabled: !!user,
  });
  const [loc, setLoc] = useState<"all" | "platform_vault" | "with_owner">("all");
  const [variant, setVariant] = useState<"all" | "signed" | "unsigned">("all");
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} label="Gagal memuat koleksi" />;
  const cards: ApiProfileEnrichedCard[] = (data.cards ?? []).filter((c) => {
    if (loc !== "all" && c.location !== loc) return false;
    if (variant !== "all" && c.variant !== variant) return false;
    return true;
  });
  const badges = (data.badges ?? []) as SharedUserBadge[];
  const level: number = data.user?.level ?? 1;
  const tier: string = data.user?.tier ?? "orbit";
  const progressPct: number = data.user?.levelProgressPct ?? 0;
  const progressLabel: string = data.user?.levelProgressLabel ?? "Progress level berikutnya";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: "1 1 320px" }}>
          <span className="eyebrow">Koleksi</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            {data.user?.displayName ?? "Koleksi"}{" "}
            <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>
              · {data.stats?.totalCards ?? cards.length} C.Card
            </em>
          </h1>
          <div className="card card-pad" style={{ marginTop: 14, background: "var(--surface-2)" }}>
            <LevelBar level={level} tier={tier} pct={progressPct} hint={progressLabel} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/me/manage" className="btn-gold">
            Kelola C.Card →
          </Link>
          <button className="btn-ghost" onClick={() => refetch()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Refresh
          </button>
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
              marginBottom: 10,
            }}
          >
            Lencana — {badges.length}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {badges.map((ub) => (
              <span key={ub.badgeId} className="pill pill-warn" title={ub.badge?.description} style={{ padding: "6px 12px", fontSize: 12 }}>
                {ub.badge?.icon} {ub.badge?.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>C.Card — {cards.length}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              className="select"
              value={loc}
              onChange={(e) => setLoc(e.target.value as typeof loc)}
              aria-label="Filter lokasi"
              style={{ fontSize: 11, padding: "4px 8px", height: 28 }}
            >
              <option value="all">Semua lokasi</option>
              <option value="with_owner">Punya saya</option>
              <option value="platform_vault">Di vault</option>
            </select>
            <select
              className="select"
              value={variant}
              onChange={(e) => setVariant(e.target.value as typeof variant)}
              aria-label="Filter varian"
              style={{ fontSize: 11, padding: "4px 8px", height: 28 }}
            >
              <option value="all">Semua varian</option>
              <option value="signed">Signed</option>
              <option value="unsigned">Unsigned</option>
            </select>
            <Link to="/me/manage" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gold)", fontWeight: 500 }}>
              Kelola →
            </Link>
          </div>
        </div>
        {cards.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            Belum punya C.Card.{" "}
            <Link to="/drops" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Jelajahi Drops →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14, padding: 14 }}>
            {cards.map((ca) => (
              <Link
                key={ca.id}
                to={`/cards/${ca.id}`}
                className="card"
                style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ height: 140 }}>
                  <CardThumb artworkUrl={ca.drop?.artworkUrl} series={ca.drop?.series} title={ca.drop?.title} />
                </div>
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {ca.drop?.title ?? ca.dropId} · #{ca.unitNumber}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                    {ca.drop?.series} {ca.buyoutPriceCcoin ? `· ${ca.buyoutPriceCcoin} C` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    <span
                      className={`pill ${ca.location === "platform_vault" ? "pill-warn" : ca.location === "with_owner" ? "pill-success" : "pill-info"}`}
                      style={{ fontSize: 10 }}
                    >
                      {ca.location ? cardLocationLabel(ca.location) : (ca.status ?? "")}
                    </span>
                    {ca.activeBid ? (
                      <span className="pill pill-success" style={{ fontSize: 10 }}>
                        Bid {ca.activeBid.amountCCoin} C
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
