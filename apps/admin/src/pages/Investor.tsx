import { ccoinToIdr, formatIdr } from "@c-verse/shared";
import { useEffect, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";

// Agregat GMV/secondary/users dihitung server-side oleh get_investor_stats;
// halaman memanggil gateway admin agar daftar drop dan metrik memakai jalur
// autentikasi yang sama.

type InvestorStats = { users: number; gmvCcoin: number; secondaryVolCcoin: number; txCount: number };
type DropPerfRow = { id: string; title: string; status: string; sold_count: number | null; total_units: number };

export function InvestorPage() {
  const [stats, setStats] = useState<InvestorStats | null>(null);
  const [drops, setDrops] = useState<DropPerfRow[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setError(false);
    setLoading(true);
    try {
      const result = await apiFetch<{ stats: InvestorStats | null; drops: DropPerfRow[] }>("/api/admin/investor");
      setStats(result.stats);
      setDrops(result.drops);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const sold = drops.reduce((n, d) => n + (d.sold_count ?? 0), 0);
  const units = drops.reduce((n, d) => n + (d.total_units ?? 0), 0);

  if (error)
    return (
      <div className="admin-msg" role="alert" aria-live="polite" style={{ margin: 24, display: "flex", gap: 8, alignItems: "center" }}>
        <span>Gagal memuat data investor — periksa koneksi lalu coba lagi.</span>
        <button className="btn-ghost admin-mini" onClick={load}>
          Coba Lagi
        </button>
      </div>
    );
  if (!stats || loading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>
          Investor Data Pack{" "}
          <span className="mono fs-11" style={{ color: "var(--dim)", fontWeight: 400 }}>
            ADM-10 · bukan untuk publik
          </span>
        </h2>
        <p className="muted">Ringkasan metrik kunci untuk meeting fundraising — GMV, user growth, drop performance, secondary volume</p>
      </div>
      <div className="admin-stats">
        <div className="admin-stat-card gold">
          <div className="admin-stat-label">GMV (C-Coin)</div>
          <div className="admin-stat-value">{stats.gmvCcoin}</div>
          <div className="admin-stat-hint">
            ≈ {formatIdr(ccoinToIdr(stats.gmvCcoin))} · {stats.txCount} transaksi tercatat
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Users</div>
          <div className="admin-stat-value">{stats.users}</div>
          <div className="admin-stat-hint">Total terdaftar</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{drops.length}</div>
          <div className="admin-stat-hint">
            {sold}/{units} unit terjual
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Secondary</div>
          <div className="admin-stat-value">{stats.secondaryVolCcoin}</div>
          <div className="admin-stat-hint">C-Coin volume</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Drop performance</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Drop</th>
                <th>Status</th>
                <th>Terjual</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {drops.slice(0, 20).map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{d.title}</td>
                  <td>
                    <StatusBadge status={d.status} kind="drop" style={{ fontSize: 10 }} />
                  </td>
                  <td className="mono">{d.sold_count ?? 0}</td>
                  <td className="mono">{d.total_units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Sumber: database internal. Data untuk internal founder saja — tidak diekspos ke publik.
      </div>
    </div>
  );
}
