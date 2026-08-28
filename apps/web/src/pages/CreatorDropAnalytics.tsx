import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import { LoadingState } from "../lib/QueryStates";
import "./commerce.css";
import "./creator-console.css";

/**
 * P0-4 (audit 2026-08-24) batch B: PG-CRT-03 — Per-drop analytics untuk kreator.
 * Tampilkan sold/inventory ratio + estimasi share kreator (30% primary 70/30).
 * Secondary royalties (7,5%) tidak dihitung di sini; lihat /creator/payouts.
 */
export default function CreatorDropAnalytics() {
  return (
    <RequireAuth>
      <CreatorDropAnalyticsInner />
    </RequireAuth>
  );
}

function CreatorDropAnalyticsInner() {
  const { dropId } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["creator-drop", dropId],
    queryFn: () => api.creatorDropAnalytics(dropId!),
    enabled: !!dropId,
  });
  if (isLoading) return <LoadingState />;
  if (isError || !data) {
    return (
      <div className="card card-pad">
        <span className="eyebrow">Drop Analytics</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Drop tidak ditemukan atau bukan milik kamu.
        </p>
        <button className="btn-ghost" onClick={() => refetch()} style={{ marginTop: 12 }}>
          Coba lagi
        </button>
        <Link
          to="/creator"
          style={{
            display: "block",
            marginTop: 12,
            color: "var(--gold)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          ← Kembali ke Dashboard
        </Link>
      </div>
    );
  }
  const { drop, cards, revenue } = data;
  const pct = cards.total > 0 ? Math.round((cards.sold / cards.total) * 100) : 0;
  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman analitik drop">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:06 / KREATOR</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">DROP ANALYTICS</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <span className="eyebrow">Drop Analytics</span>
            <h1 className="page-hero-title">{drop.title}</h1>
            <div className="page-hero-sub">
              {drop.series} · {drop.totalUnits} unit
            </div>
            <Link className="cx-hero-back btn-ghost" to="/creator">
              ← Kembali ke Dashboard
            </Link>
          </div>
          <div className="cx-hero-actions">
            <StatusBadge status={drop.status} kind="drop" />
            <Link to={`/drops/${drop.id}`} className="btn-ghost cm-hero-cta">
              Publik →
            </Link>
          </div>
        </div>
      </section>

      <div className="grid-3">
        <div className="card card-pad cx-stat">
          <span className="label">Terjual</span>
          <div className="cx-stat-value">
            {cards.sold} / {cards.total}
          </div>
          <div className="cx-stat-sub">{pct}% sold</div>
          <div className="progress" style={{ marginTop: 10, height: 4 }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="card card-pad cx-stat">
          <span className="label">Inventory</span>
          <div className="cx-stat-value">{cards.inventory}</div>
          <div className="cx-stat-sub">{cards.withBuyout} sedang dijual</div>
        </div>
        <div className="card card-pad gold cx-stat">
          <span className="label cx-stat-label-gold">Creator Share (30% Primary)</span>
          <div className="cx-stat-value">
            {revenue.creatorSharePrimaryCcoin} <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>C</span>
          </div>
          <div className="cx-stat-sub">{formatIdr(revenue.creatorSharePrimaryIdr)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            Share kamu dari primary 70/30. Secondary royalties tampil di{" "}
            <Link to="/creator/payouts" style={{ color: "var(--gold)" }}>
              Payout
            </Link>
            .
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Ringkasan Revenue Primary</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <Row label="Harga per kartu" value={`${drop.priceCCoin ?? drop.priceUnsignedCCoin ?? 0} C`} />
          <Row label="Kartu terjual" value={`${cards.sold} unit`} />
          <Row label="Total revenue" value={formatIdr(revenue.soldIdr)} mono />
          <Row label="Creator share (30%)" value={`${revenue.creatorSharePrimaryCcoin} C · ${formatIdr(revenue.creatorSharePrimaryIdr)}`} />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
          Release instan untuk pembelian vault, setelah kartu terkirim untuk shipping — payout batch mingguan di{" "}
          <Link to="/creator/payouts" style={{ color: "var(--gold)" }}>
            Payout
          </Link>
          .
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span className="muted">{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : undefined, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
