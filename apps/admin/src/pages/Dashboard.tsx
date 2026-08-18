import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function DashboardPage() {
  const [stats, setStats] = useState<{ drops: number; orders: number; creators: number }>({ drops: 0, orders: 0, creators: 0 });
  useEffect(() => {
    async function load() {
      const [d, o, c] = await Promise.all([
        supabase.from("drops").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("creators").select("id", { count: "exact", head: true }),
      ]);
      setStats({ drops: d.count ?? 0, orders: o.count ?? 0, creators: c.count ?? 0 });
    }
    load();
  }, []);
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Dashboard</h2>
        <p className="muted">Ringkasan operasional</p>
      </div>

      <div className="admin-stats">
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{stats.drops}</div>
          <div className="admin-stat-hint">Koleksi aktif</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Pesanan</div>
          <div className="admin-stat-value">{stats.orders}</div>
          <div className="admin-stat-hint">Perlu diproses</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Kreator</div>
          <div className="admin-stat-value">{stats.creators}</div>
          <div className="admin-stat-hint">Terdaftar</div>
        </div>
        <div className="admin-stat-card gold">
          <div className="admin-stat-label">Sistem</div>
          <div className="admin-stat-value" style={{ fontSize: 14 }}>
            Terhubung
          </div>
          <div className="admin-stat-hint">Supabase aktif · MFA aal2</div>
        </div>
      </div>

      <div className="grid-3">
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">◈</div>
          <div className="fw-700">Drops</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Buat dan atur jadwal rilis
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">⧉</div>
          <div style={{ fontWeight: 700 }}>Pesanan</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Proses hingga selesai
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">₵</div>
          <div style={{ fontWeight: 700 }}>Payout</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Batch dan rekonsiliasi
          </div>
        </div>
      </div>
      <div className="grid-3" style={{ marginTop: 14 }}>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">⬡</div>
          <div style={{ fontWeight: 700 }}>NFC</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Batch dan QC kartu
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">✦</div>
          <div style={{ fontWeight: 700 }}>Lencana</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Atur penghargaan
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">◷</div>
          <div style={{ fontWeight: 700 }}>Audit</div>
          <div className="muted fs-12" style={{ marginTop: 4 }}>
            Riwayat perubahan
          </div>
        </div>
      </div>
    </div>
  );
}
