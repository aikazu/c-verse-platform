import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropsResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import "./creator-console.css";

// Founder 2026-08-29: dashboard kreator READ-ONLY analytics (docs 02 PG-CRT-01
// "Traffic + pendapatan SAJA"). Pembuatan, penjadwalan, dan pembatalan drop
// adalah wewenang admin (docs 03 ADM-02) — tidak ada form/tombol mutasi di sini.

export default function CreatorDashboard() {
  return (
    <RequireAuth>
      <CreatorDashboardInner />
    </RequireAuth>
  );
}

function CreatorDashboardInner() {
  const { user } = useAuth();
  const { data: dropsData } = useQuery<ApiDropsResponse>({ queryKey: ["creator-drops"], queryFn: () => api.drops({}) });

  // RequireAuth di atas menjamin user non-null di sini; narrow untuk typecheck.
  if (!user) return null;
  if (user.role !== "creator" && user.role !== "admin")
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Kreator</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Khusus akun kreator.
        </p>
      </div>
    );

  const myDrops: ApiDrop[] = (dropsData?.drops ?? []).filter((d) => d.creatorId === user.id || user.role === "admin");

  return (
    <div className="page-stack">
      <PageHero channel="06B" channelLabel="KREATOR" title="Dasbor Kreator" />

      <div className="grid-3">
        <div className="card card-pad cx-stat">
          <span className="label">TOTAL DROPS</span>
          <div className="cx-stat-value">{myDrops.length}</div>
        </div>
        <div className="card card-pad cx-stat">
          <span className="label">TERJUAL</span>
          <div className="cx-stat-value">{myDrops.reduce((n, d) => n + d.soldCount, 0)}</div>
        </div>
        <div className="card card-pad cx-stat">
          <span className="label">ESTIMASI NILAI PENJUALAN</span>
          <div className="cx-stat-value-mono">
            {formatIdr(myDrops.reduce((n, d) => n + d.soldCount * ((d.priceCcoin ?? d.priceUnsignedCCoin) * 10000), 0))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cx-head">
          <span className="cx-head-title">Drops Saya</span>
          <span className="cx-head-count">{myDrops.length}</span>
        </div>
        <div>
          {myDrops.length === 0 ? (
            <div className="empty-arcade cx-drop-empty" role="status">
              <div className="empty-title">Belum ada drop</div>
            </div>
          ) : (
            myDrops.map((d) => (
              <div className="cx-drop-row" key={d.id}>
                <Link className="cx-drop-link" to={`/creator/drops/${d.id}`}>
                  <div className="cx-drop-title">{d.title}</div>
                  <div className="cx-drop-meta">
                    {d.series} · {d.soldCount}/{d.totalUnits} · {d.priceCcoin ?? d.priceUnsignedCCoin} C
                  </div>
                </Link>
                <div className="cx-drop-actions">
                  <StatusBadge status={d.status} kind="drop" style={{ fontSize: 10 }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
