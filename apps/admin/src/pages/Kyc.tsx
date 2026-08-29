import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import { errMessage } from "../lib/utils";
import { type KycAdminRow, kycRowToDisplay } from "./kycRows";

export function KycPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<KycAdminRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { kyc } = await apiFetch<{ kyc: KycAdminRow[] }>("/api/kyc/admin/all");
      setRows(kyc);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: "approve" | "reject") {
    const approved = action === "approve";
    if (
      !(await confirm({
        title: approved ? "Setujui pengajuan KYC ini?" : "Tolak pengajuan KYC ini?",
        ...(approved ? { message: "User bisa menarik dana setelah disetujui." } : {}),
        confirmLabel: approved ? "Setujui" : "Tolak",
        danger: !approved,
      }))
    )
      return;
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
                rows.map((row) => {
                  const view = kycRowToDisplay(row);
                  return (
                    <tr key={view.id}>
                      <td className="mono fs-11">{view.userShort}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{view.fullName}</td>
                      <td className="mono fs-11">{view.maskedNik}</td>
                      <td>
                        <StatusBadge status={view.status} kind="kyc" />
                      </td>
                      <td style={{ fontSize: 11 }}>{view.submittedLabel}</td>
                      <td className="flex-gap-6">
                        {view.status === "pending" ? (
                          <>
                            <button className="btn-gold admin-mini" onClick={() => decide(view.id, "approve")} disabled={busy}>
                              Setujui
                            </button>
                            <button className="btn-ghost admin-mini" onClick={() => decide(view.id, "reject")} disabled={busy}>
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
