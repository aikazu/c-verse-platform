import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { AuditRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setMsg(null);
    try {
      const { audit } = await apiFetch<{ audit: AuditRow[] }>("/api/admin/audit?limit=100");
      setRows(audit);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  const term = filter.trim().toLowerCase();
  const visible = term ? rows.filter((r) => r.action.toLowerCase().includes(term)) : rows;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Audit Log</h2>
        <p className="muted">Riwayat aktivitas admin — append-only, ditulis server-side oleh API</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Cari aksi…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="card">
        <div className="admin-table-head">100 terbaru</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Admin</th>
                <th>Aksi</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Belum ada aktivitas
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(r.created_at).toLocaleString("id-ID")}</td>
                    <td className="mono fs-11">{r.admin_user_id.slice(0, 10)}</td>
                    <td>
                      <span className="pill pill-info">{r.action}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {r.target_table}
                      {r.target_id ? `:${String(r.target_id).slice(0, 8)}` : ""}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.payload_summary != null ? JSON.stringify(r.payload_summary) : "—"}
                    </td>
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
