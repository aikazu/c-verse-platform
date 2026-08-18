import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";
import { errMessage } from "../lib/utils";
import type { PayoutBatchRow, PayoutRow } from "../lib/types";

export function PayoutsPage() {
  const [batches, setBatches] = useState<PayoutBatchRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase
        .from("payout_batches")
        .select("id,batch_code,status,total_ccoin,total_idr")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("payouts")
        .select("id,user_id,type,ccoin_amount,idr_amount,status,batch_id")
        .order("batch_id", { ascending: false })
        .limit(500),
    ]);
    setBatches((b ?? []) as PayoutBatchRow[]);
    setPayouts((p ?? []) as PayoutRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function triggerBatch() {
    setBusy(true);
    setMsg(null);
    try {
      const { batchId } = await apiFetch<{ batchId: string | null }>("/api/payments/admin/payout-run", { method: "POST" });
      setMsg(
        batchId
          ? `Batch ${batchId} dibuat — payout eligible dikelompokkan`
          : "Tidak ada payout eligible (min 10 C, KYC approved, tanpa hold)",
      );
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Payout</h2>
        <p className="muted">Kelola pencairan dan rekonsiliasi — batch via API (ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-gold" onClick={triggerBatch} disabled={busy}>
          {busy ? "Menjalankan…" : "Jalankan Batch"}
        </button>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="card">
        <div className="admin-table-head">Batch — {batches.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Total C</th>
                <th>Total IDR</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Belum ada batch
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono fs-11">{b.batch_code}</td>
                    <td>
                      <span className="pill pill-info">{b.status}</span>
                    </td>
                    <td>{b.total_ccoin}</td>
                    <td>{b.total_idr}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Payout — {payouts.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Tipe</th>
                <th>C-Coin</th>
                <th>IDR</th>
                <th>Status</th>
                <th>Batch</th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Belum ada payout
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="mono fs-11">{p.user_id.slice(0, 8)}</td>
                    <td>{p.type}</td>
                    <td>{p.ccoin_amount}</td>
                    <td>{p.idr_amount ?? "—"}</td>
                    <td>
                      <span className="pill pill-info">{p.status}</span>
                    </td>
                    <td className="mono fs-11">{p.batch_id ? p.batch_id.slice(0, 8) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}