import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { KycRow } from "../lib/types";
import { errMessage, maskNik } from "../lib/utils";

export function KycPage() {
  const [rows, setRows] = useState<KycRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { kyc } = await apiFetch<{ kyc: KycRow[] }>("/api/kyc/admin/all");
      setRows(kyc);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: "approve" | "reject") {
    const confirmMsg =
      action === "approve" ? "Setujui pengajuan KYC ini? User bisa menarik dana setelah disetujui." : "Tolak pengajuan KYC ini?";
    if (!window.confirm(confirmMsg)) return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/kyc/${id}/${action}`, { method: "POST" });
      setMsg(`KYC ${id.slice(0, 8)} ${action === "approve" ? "disetujui" : "ditolak"}`);
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
        <h2>KYC</h2>
        <p className="muted">Review KYC untuk payout &amp; top-up besar (via API, ter-audit)</p>
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
                <th>User</th>
                <th>Nama</th>
                <th>NIK</th>
                <th>Status</th>
                <th>Diajukan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Belum ada pengajuan
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono fs-11">{r.user_id.slice(0, 8)}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{r.full_name}</td>
                    <td className="mono fs-11">{maskNik(r.nik)}</td>
                    <td>
                      <span className="pill pill-info">{r.status}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString("id-ID")}</td>
                    <td className="flex-gap-6">
                      {r.status === "pending" ? (
                        <>
                          <button className="btn-gold admin-mini" onClick={() => decide(r.id, "approve")} disabled={busy}>
                            Setujui
                          </button>
                          <button className="btn-ghost admin-mini" onClick={() => decide(r.id, "reject")} disabled={busy}>
                            Tolak
                          </button>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Selesai
                        </span>
                      )}
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
