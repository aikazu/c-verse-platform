import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { BadgeRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function BadgesPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoadError(false);
    const { data, error } = await supabase.from("badges").select("*").order("created_at", { ascending: false });
    if (error) {
      setLoadError(true);
      return;
    }
    setRows((data ?? []) as BadgeRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(b: BadgeRow) {
    const isCurrentlyActive = b.is_active ?? true;
    const willDeactivate = isCurrentlyActive;
    if (
      !(await confirm({
        title: willDeactivate ? `Nonaktifkan lencana "${b.name}"?` : `Aktifkan lencana "${b.name}"?`,
        ...(willDeactivate ? { message: "User tidak bisa memperoleh lencana ini selama nonaktif." } : {}),
        confirmLabel: willDeactivate ? "Nonaktifkan" : "Aktifkan",
        danger: willDeactivate,
      }))
    )
      return;
    setMsg(null);
    setBusyId(b.id);
    try {
      await apiFetch(`/api/gamification/badges/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !isCurrentlyActive }) });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Lencana</h2>
        <p className="muted">Aktifkan/nonaktifkan lencana (via API, ter-audit)</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      {loadError && (
        <div className="admin-msg" role="alert" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>Gagal memuat data lencana — periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost admin-mini" onClick={load}>
            Coba Lagi
          </button>
        </div>
      )}
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>XP</th>
                <th>Kriteria</th>
                <th>Aktif</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Belum ada data
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 11 }}>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.xp_reward ?? 0}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {typeof r.criteria === "string" ? r.criteria : JSON.stringify(r.criteria)}
                    </td>
                    <td>{String(r.is_active ?? true)}</td>
                    <td>
                      <button className="btn-ghost admin-mini" onClick={() => toggleActive(r)} disabled={busyId === r.id}>
                        {(r.is_active ?? true) ? "Nonaktifkan" : "Aktifkan"}
                      </button>
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
