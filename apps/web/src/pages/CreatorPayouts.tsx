import { useQuery } from "@tanstack/react-query";
import { RequireAuth } from "../components/RequireAuth";
import { api, formatIdr } from "../lib/api";
import { LoadingState } from "../lib/QueryStates";

interface PayoutRow {
  id: string;
  batch_id: string | null;
  type: "creator_share" | "seller_proceeds" | "royalty";
  ccoin_amount: number;
  idr_amount: number;
  status: string;
  requested_at: string;
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
        <span className="eyebrow">Payout</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Gagal memuat payout.
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <span className="eyebrow">Payout Kreator</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Riwayat <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Payout</em>
        </h1>
      </div>
      <div className="grid-2" style={{ alignItems: "stretch" }}>
        <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Total C-Coin Didapat
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500, marginTop: 6 }}>
            {totalCCoin} <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>C</span>
          </div>
        </div>
        <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Total Disbursement (IDR)
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, marginTop: 6 }}>{formatIdr(totalIdr)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Setelah withholding pajak + fee 1%
          </div>
        </div>
      </div>
      <div className="card">
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Daftar Payout — {list.length}
        </div>
        {list.length === 0 ? (
          <div className="muted" style={{ padding: 24, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Belum ada payout — settled setelah escrow release + batch mingguan
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
                        {p.type === "creator_share" ? "Creator" : p.type === "royalty" ? "Royalty" : "Seller"}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.ccoin_amount} C</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatIdr(p.idr_amount)}</td>
                    <td>
                      <span
                        className={`pill ${p.status === "paid" ? "pill-success" : p.status === "failed" ? "pill-warn" : "pill-info"}`}
                        style={{ fontSize: 10 }}
                      >
                        {p.status}
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
