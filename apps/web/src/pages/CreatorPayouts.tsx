import { useQuery } from "@tanstack/react-query";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { api, formatIdr } from "../lib/api";
import { LoadingState } from "../lib/QueryStates";
import "./creator-console.css";

interface PayoutRow {
  id: string;
  batch_id: string | null;
  type: "creator_share" | "seller_proceeds" | "royalty";
  ccoin_amount: number;
  idr_amount: number;
  status: string;
  requested_at: string;
}

function payoutTypeLabel(type: PayoutRow["type"]): string {
  if (type === "creator_share") return "Bagian kreator";
  if (type === "royalty") return "Royalti";
  return "Hasil penjualan";
}

function payoutStatusLabel(status: string): string {
  if (status === "disbursed" || status === "paid") return "Selesai";
  if (status === "failed") return "Gagal";
  if (status === "refunded") return "Dana dikembalikan";
  if (status === "pending") return "Menunggu diproses";
  if (status === "processing") return "Diproses";
  return "Status belum tersedia";
}

// P0-4 (audit 2026-08-24): PG-CRT-04 — Riwayat payout + royalti secondary.
// URL /api/creators/me/payouts mengembalikan daftar payout untuk user saat
// ini (kreator). Tipe payout (creator_share / royalty) adalah 70/30 primary +
// 7,5/7,5/85 secondary. Fee 1% dipotong saat disbursement (handled by
// cron payout_batch_run).
export default function CreatorPayouts() {
  return (
    <RequireAuth>
      <CreatorPayoutsInner />
    </RequireAuth>
  );
}

function CreatorPayoutsInner() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["creator-payouts"],
    queryFn: () => api.myPayouts(),
  });
  if (isLoading) return <LoadingState />;
  if (isError)
    return (
      <div className="card card-pad">
        <span className="eyebrow">Penarikan</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Gagal memuat riwayat penarikan.
        </p>
        <button className="btn-ghost" onClick={() => refetch()}>
          Coba lagi
        </button>
      </div>
    );
  const list: PayoutRow[] = data?.payouts ?? [];
  const totalCCoin = list.reduce((sum, p) => sum + p.ccoin_amount, 0);
  const totalIdr = list.reduce((sum, p) => sum + p.idr_amount, 0);
  return (
    <div className="page-stack">
      <PageHero channel="06D" channelLabel="KREATOR" title="Riwayat Penarikan" />
      <div className="grid-2" style={{ alignItems: "stretch" }}>
        <div className="card card-pad cx-stat">
          <span className="label">Total C-Gems Diajukan</span>
          <div className="cx-stat-value">
            {totalCCoin} <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>C-Gems</span>
          </div>
        </div>
        <div className="card card-pad cx-stat">
          <span className="label">Total pengajuan (rupiah)</span>
          <div className="cx-stat-value">{formatIdr(totalIdr)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Setelah potongan yang tercatat pada pengajuan
          </div>
        </div>
      </div>
      <div className="card">
        <div className="cx-head">
          <span className="cx-head-title">Daftar Penarikan — {list.length}</span>
        </div>
        {list.length === 0 ? (
          <div className="empty-arcade cx-drop-empty" role="status">
            <p className="empty-msg">Belum ada penarikan</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Tipe</th>
                  <th>Jumlah</th>
                  <th>IDR</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(p.requested_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td>
                      <span className="pill pill-info" style={{ fontSize: 10 }}>
                        {payoutTypeLabel(p.type)}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.ccoin_amount} C</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatIdr(p.idr_amount)}</td>
                    <td>
                      <span
                        className={`pill ${p.status === "disbursed" || p.status === "paid" ? "pill-success" : p.status === "failed" ? "pill-warn" : "pill-info"}`}
                        style={{ fontSize: 10 }}
                      >
                        {payoutStatusLabel(p.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
