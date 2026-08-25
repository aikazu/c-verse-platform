import { ccoinToIdr, formatIdr } from "@c-verse/shared";
import { useEffect, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../lib/supabase";

export function InvestorPage() {
  const [data, setData] = useState<{
    gmv: number;
    secondaryVol: number;
    users: number;
    drops: number;
    sold: number;
    units: number;
    dropsRows: { id: string; title: string; status: string; sold_count: number | null; total_units: number }[];
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function load() {
      setError(false);
      const [wtx, us, dr] = await Promise.all([
        supabase.from("wallet_transactions").select("amount_ccoin,type,ref_type").limit(1000),
        supabase.from("users").select("id,total_xp").limit(1000),
        supabase.from("drops").select("id,title,status,total_units,sold_count").limit(100),
      ]);
      if (wtx.error || us.error || dr.error) {
        setError(true);
        return;
      }
      const w = (wtx.data ?? []) as { amount_ccoin: number; type: string; ref_type: string | null }[];
      const users = (us.data ?? []) as { id: string }[];
      const drops = (dr.data ?? []) as { id: string; title: string; status: string; total_units: number; sold_count: number | null }[];
      // GMV: primary checkout ('checkout' ref='drop'), settled secondary buyout ('platform_buy'),
      // dan seed buyout PHASE-1 escrow ('escrow_hold' ref_type='card' — buyout_card
      // di 04_rpc.sql, sebelumnya 20260823020000_seed_xp_unify.sql).
      // Place-bid escrow ('escrow_hold' ref_type='bid') TIDAK masuk GMV karena belum settled.
      const gmv = w
        .filter((t) => t.type === "checkout" || t.type === "platform_buy" || (t.type === "escrow_hold" && t.ref_type === "card"))
        .reduce((n, t) => n + Math.abs(t.amount_ccoin), 0);
      const secondaryVol = w.filter((t) => t.type === "payout" || t.type === "royalty").reduce((n, t) => n + Math.abs(t.amount_ccoin), 0);
      setData({
        gmv,
        secondaryVol,
        users: users.length,
        drops: drops.length,
        sold: drops.reduce((n, d) => n + (d.sold_count ?? 0), 0),
        units: drops.reduce((n, d) => n + (d.total_units ?? 0), 0),
        dropsRows: drops,
      });
    }
    load();
  }, []);

  if (error)
    return (
      <div className="admin-msg" role="alert" aria-live="polite" style={{ margin: 24 }}>
        Gagal memuat data investor — periksa koneksi lalu muat ulang halaman.
      </div>
    );
  if (!data)
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
          <div className="admin-stat-value">{data.gmv}</div>
          <div className="admin-stat-hint">≈ {formatIdr(ccoinToIdr(data.gmv))}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Users</div>
          <div className="admin-stat-value">{data.users}</div>
          <div className="admin-stat-hint">Total terdaftar</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{data.drops}</div>
          <div className="admin-stat-hint">
            {data.sold}/{data.units} unit terjual
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Secondary</div>
          <div className="admin-stat-value">{data.secondaryVol}</div>
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
              {data.dropsRows.slice(0, 20).map((d) => (
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
        Sumber: Supabase (RLS, authenticated read). Data untuk internal founder saja — tidak diekspos ke publik.
      </div>
    </div>
  );
}
