import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import { LoadingState } from "../lib/QueryStates";

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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Drop Analytics</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            {drop.title}
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {drop.series} · {drop.totalUnits} unit
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StatusBadge status={drop.status} kind="drop" />
          <Link to={`/drops/${drop.id}`} className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Publik →
          </Link>
        </div>
      </div>

      <div className="grid-3">
        <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Terjual
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, marginTop: 6 }}>
            {cards.sold} / {cards.total}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            {pct}% sold
          </div>
          <div className="progress" style={{ marginTop: 10, height: 4 }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Inventory
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, marginTop: 6 }}>{cards.inventory}</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            {cards.withBuyout} sedang dijual
          </div>
        </div>
        <div className="card card-pad gold" style={{ background: "var(--surface-2)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--gold)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Creator Share (30% Primary)
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, marginTop: 6 }}>
            {revenue.creatorSharePrimaryCcoin} <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>C</span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            {formatIdr(revenue.creatorSharePrimaryIdr)}
          </div>
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
          Settlement share ini setelah escrow release (DELIVERED + H+7 untuk shipping; instant saat vault). Payout via batch mingguan ke{" "}
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
