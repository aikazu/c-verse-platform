import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { DisputeRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function DisputesPage() {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: string; notes: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { disputes } = await apiFetch<{ disputes: DisputeRow[] }>("/api/admin/disputes");
      setRows(disputes);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  function setDraft(id: string, patch: Partial<{ status: string; notes: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { status: prev[id]?.status ?? "under_review", notes: prev[id]?.notes ?? "", ...patch } }));
  }

  async function decide(id: string) {
    const draft = drafts[id] ?? { status: "under_review", notes: "" };
    const suspends = draft.status === "resolved_suspend";
    const confirmMsg = suspends
      ? "Selesaikan sengketa dengan SUSPEND user? Akun terkait akan dinonaktifkan."
      : `Simpan keputusan sengketa (${draft.status})?`;
    if (!window.confirm(confirmMsg)) return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/admin/disputes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, decisionNotes: draft.notes || undefined }),
      });
      setMsg(`Disput ${id.slice(0, 8)} diperbarui`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const RESOLUTIONS = ["under_review", "resolved_refund", "resolved_strike", "resolved_suspend"];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Sengketa</h2>
        <p className="muted">Tinjau dan selesaikan laporan (via API, ter-audit)</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Keputusan</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Belum ada laporan
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isResolved = r.status.startsWith("resolved_");
                  return (
                    <tr key={r.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id.slice(0, 10)}</td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>{r.reason}</td>
                      <td>
                        <span className="pill pill-info">{r.status}</span>
                        {r.decision_notes ? (
                          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                            {r.decision_notes}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {isResolved ? (
                          <span className="muted" style={{ fontSize: 11 }}>
                            Selesai
                          </span>
                        ) : (
                          <div className="flex-gap-6 flex-wrap" style={{ minWidth: 260 }}>
                            <select
                              className="input fs-11 input-mini"
                              aria-label="Resolusi sengketa"
                              value={drafts[r.id]?.status ?? "under_review"}
                              onChange={(e) => setDraft(r.id, { status: e.target.value })}
                            >
                              {RESOLUTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <textarea
                              className="input"
                              aria-label="Catatan keputusan"
                              placeholder="Catatan keputusan"
                              value={drafts[r.id]?.notes ?? ""}
                              onChange={(e) => setDraft(r.id, { notes: e.target.value })}
                              rows={2}
                              style={{ flex: 1, minWidth: 140, fontSize: 11, padding: "4px 8px" }}
                            />
                            <button className="btn-gold admin-mini" onClick={() => decide(r.id)} disabled={busy}>
                              Simpan
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
