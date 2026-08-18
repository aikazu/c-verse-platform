import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { CardRow, NfcBatchRow } from "../lib/types";

export function NfcPage() {
  const [batches, setBatches] = useState<NfcBatchRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data: b, error: bErr } = await supabase
      .from("nfc_batches")
      .select("id,batch_code,qty,status")
      .order("created_at", { ascending: false });
    setBatches((b ?? []) as NfcBatchRow[]);
    const { data: c, error: cErr } = await supabase
      .from("cards")
      .select("id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status")
      .limit(50);
    setCards((c ?? []) as CardRow[]);
    const err = bErr ?? cErr;
    if (err) setMsg(err.message);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>NFC</h2>
        <p className="muted">Pantau batch dan verifikasi kartu (read-only — provisioning via backend)</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="admin-table-head">Batch — {batches.length}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-state">
                      Belum ada batch
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id}>
                      <td className="mono fs-11">{b.batch_code}</td>
                      <td>{b.qty}</td>
                      <td>
                        <span className="pill pill-info">{b.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="admin-table-head">Kartu — sampel 50</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>UID</th>
                  <th>QC</th>
                  <th>Verifikasi</th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  cards.map((c) => (
                    <tr key={c.id}>
                      <td className="mono fs-11">{c.nfc_short_id}</td>
                      <td className="mono fs-11">{(c.nfc_uid ?? "").slice(0, 12)}</td>
                      <td>
                        <span className="pill pill-info">{c.qc_status ?? "—"}</span>
                      </td>
                      <td>{c.verify_status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
