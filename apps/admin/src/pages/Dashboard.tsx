import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { buildWorkQueue, type WorkQueueCounts } from "./workQueue";

// Dashboard now surfaces an operational work queue — counts of items that
// need admin attention — alongside the three platform-wide stats. Status
// filters mirror the sibling pages exactly:
//   - shipmentsActionable → Orders.tsx  (shipments `requested`/`packed`)
//   - kycPending          → Kyc.tsx      (status = `pending`)
//   - disputesOpen        → Disputes.tsx (status `open` or `under_review`)
//   - payoutsPending      → Payouts.tsx  (status `pending` | `processing` | `failed`)
//
// `payoutsPending` intentionally widens beyond `pending` because Payouts.tsx's
// `canRefund` treats `processing`/`failed` rows as actionable too; a dashboard
// showing "0 menunggu" while /payouts shows refundable rows breaks trust.

type Stats = { drops: number; orders: number; creators: number };
type DashboardResponse = { stats: { drops: number | null; orders: number | null; creators: number | null }; counts: WorkQueueCounts };

export function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ drops: 0, orders: 0, creators: 0 });
  const [counts, setCounts] = useState<WorkQueueCounts>({
    shipmentsActionable: 0,
    kycPending: 0,
    disputesOpen: 0,
    payoutsPending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      const { stats: nextStats, counts: nextCounts } = await apiFetch<DashboardResponse>("/api/admin/dashboard");

      if (cancelled) return;
      if (nextStats.drops === null || nextStats.orders === null || nextStats.creators === null) {
        setError(true);
      }
      setStats({ drops: nextStats.drops ?? 0, orders: nextStats.orders ?? 0, creators: nextStats.creators ?? 0 });
      setCounts(nextCounts);
      setLoading(false);
    }
    load().catch(() => {
      if (cancelled) return;
      setError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue = buildWorkQueue(counts);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Dashboard</h2>
        <p className="muted">Ringkasan operasional</p>
      </div>

      {error && (
        <div className="admin-msg" role="alert" aria-live="polite">
          Gagal memuat ringkasan — periksa koneksi lalu muat ulang halaman.
        </div>
      )}

      <div className="admin-stats">
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{loading ? "…" : stats.drops}</div>
          <div className="admin-stat-hint">Koleksi aktif</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Pesanan</div>
          <div className="admin-stat-value">{loading ? "…" : stats.orders}</div>
          <div className="admin-stat-hint">Total tercatat</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Kreator</div>
          <div className="admin-stat-value">{loading ? "…" : stats.creators}</div>
          <div className="admin-stat-hint">Terdaftar</div>
        </div>
      </div>

      <section className="admin-workqueue" aria-label="Antrian kerja operasional">
        <div className="admin-workqueue-head">
          <div className="admin-workqueue-title">Antrian kerja</div>
          <div className="muted fs-11">Item yang butuh tindakan admin</div>
        </div>
        {loading ? (
          <div className="admin-workqueue-empty muted fs-12">Memuat antrian…</div>
        ) : queue.length === 0 ? (
          <div className="admin-workqueue-empty muted fs-12">Tidak ada item yang menunggu.</div>
        ) : (
          <ul className="admin-workqueue-list">
            {queue.map((entry) => {
              const display = entry.count === null ? "—" : entry.count.toLocaleString("id-ID");
              return (
                <li key={entry.id}>
                  <NavLink to={entry.to} className="admin-workqueue-row">
                    <div className="admin-workqueue-row-text">
                      <div className="admin-workqueue-label">{entry.label}</div>
                      <div className="admin-workqueue-hint">{entry.hint}</div>
                    </div>
                    <div className="admin-workqueue-count">{display}</div>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
