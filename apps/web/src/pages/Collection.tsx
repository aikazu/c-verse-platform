import type { UserBadge as SharedUserBadge } from "@c-verse/shared";
import { cardLocationLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { CollectorGuide } from "../components/CollectorGuide";
import { LevelBar } from "../components/LevelBar";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { ShowcaseEditor } from "../components/Showcase";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import "./collection.css";

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
    <div className="page-stack">
      <PageHero channel="09" channelLabel="KOLEKSI" title="Koleksi" desc={`${cards.length} unit · Level ${level} · ${tier}`} />

      <div className="kl-head">
        <div className="kl-head-copy">
          <h2 className="h2 kl-title">
            {data.user?.displayName ?? "Koleksi"} <em>· {data.stats?.totalCards ?? cards.length} C.Card</em>
          </h2>
          <div className="card card-pad kl-level">
            <LevelBar level={level} tier={tier} pct={progressPct} hint={progressLabel} />
          </div>
        </div>
        <div className="kl-head-actions">
          <Link to="/me/manage" className="btn-gold">
            Kelola C.Card →
          </Link>
          <button className="btn-ghost kl-btn-mono" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      </div>
      <CollectorGuide topic="vault" />
      <ShowcaseEditor profile={data} />
      {badges.length > 0 && (
        <div className="card card-pad">
          <div className="label kl-label-dim">Lencana — {badges.length}</div>
          <div className="kl-badges">
            {badges.map((ub) => (
              <span key={ub.badgeId} className="pill pill-warn kl-badge" title={ub.badge?.description}>
                {ub.badge?.icon} {ub.badge?.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="kl-toolbar">
          <span className="kl-toolbar-title">C.Card — {cards.length}</span>
          <div className="kl-filters">
            <select className="select" value={loc} onChange={(e) => setLoc(e.target.value as typeof loc)} aria-label="Filter lokasi">
              <option value="all">Semua lokasi</option>
              <option value="with_owner">Disimpan oleh saya</option>
              <option value="platform_vault">Di Vault</option>
            </select>
            <select
              className="select"
              value={variant}
              onChange={(e) => setVariant(e.target.value as typeof variant)}
              aria-label="Filter varian"
            >
              <option value="all">Semua varian</option>
              <option value="signed">Signed</option>
              <option value="unsigned">Reguler</option>
            </select>
            <Link to="/me/manage" className="kl-link">
              Kelola →
            </Link>
          </div>
        </div>
        {cards.length === 0 ? (
          <div className="kl-empty">
            Belum punya C.Card.{" "}
            <Link to="/drops" className="kl-empty-link">
              Jelajahi Drops →
            </Link>
          </div>
        ) : (
          <div className="kl-grid">
            {cards.map((ca) => (
              <Link key={ca.id} to={`/cards/${ca.id}`} className="card kl-tile">
                <div className="kl-thumb">
                  <CardThumb artworkUrl={ca.drop?.artworkUrl} series={ca.drop?.series} title={ca.drop?.title} />
                </div>
                <div className="kl-tile-body">
                  <div className="kl-tile-title">
                    {ca.drop?.title ?? "Tanpa judul"} · #{ca.unitNumber}
                  </div>
                  <div className="kl-tile-meta">
                    {ca.drop?.series} {ca.buyoutPriceCcoin ? `· ${ca.buyoutPriceCcoin} C` : ""}
                  </div>
                  <div className="kl-tile-pills">
                    <span
                      className={`pill ${ca.location === "platform_vault" ? "pill-warn" : ca.location === "with_owner" ? "pill-success" : "pill-info"} kl-pill-sm`}
                    >
                      {ca.location ? cardLocationLabel(ca.location) : (ca.status ?? "")}
                    </span>
                    {ca.activeBid ? <span className="pill pill-success kl-pill-sm">Penawaran {ca.activeBid.amountCCoin} C</span> : null}
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
