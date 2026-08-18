import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/api";
import { errMessage } from "../lib/utils";
import type { BadgeRow } from "../lib/types";

export function BadgesPage() {
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("badges").select("*").order("created_at", { ascending: false });
    setRows((data ?? []) as BadgeRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(b: BadgeRow) {
    setMsg(null);
    try {
      const isActive = !(b.is_active ?? true);
      await apiFetch(`/api/gamification/badges/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Lencana</h2>
        <p className="muted">Aktifkan/nonaktifkan lencana (via API, ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
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
                      <button className="btn-ghost admin-mini" onClick={() => toggleActive(r)}>
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