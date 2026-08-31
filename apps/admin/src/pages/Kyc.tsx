import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import { errMessage } from "../lib/utils";
import { buildKycRejectBody, kycRejectConfirmMessage, normalizeKycRejectReason } from "./kycReject";
import { type KycAdminRow, kycRowToDisplay } from "./kycRows";

export function KycPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<KycAdminRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Alur tolak (audit batch 3): alasan penolakan WAJIB — panel terbuka saat
  // tombol Tolak ditekan, lalu confirm danger menampilkan alasan sebelum kirim.
  const [rejectTarget, setRejectTarget] = useState<KycAdminRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  async function decide(id: string) {
    if (
      !(await confirm({
        title: "Setujui pengajuan KYC ini?",
        message: "User bisa menarik dana setelah disetujui.",
        confirmLabel: "Setujui",
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/kyc/${id}/approve`, { method: "POST" });
      setMsg(`KYC ${id.slice(0, 8)} disetujui`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function startReject(row: KycAdminRow) {
    setMsg(null);
    setRejectReason("");
    setRejectTarget(row);
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const reason = normalizeKycRejectReason(rejectReason);
    if (!reason) return;
    if (
      !(await confirm({
        title: `Tolak pengajuan KYC ${rejectTarget.id.slice(0, 8)}?`,
        message: kycRejectConfirmMessage(reason),
        confirmLabel: "Tolak",
        danger: true,
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/kyc/${rejectTarget.id}/reject`, { method: "POST", body: JSON.stringify(buildKycRejectBody(reason)) });
      setMsg(`KYC ${rejectTarget.id.slice(0, 8)} ditolak`);
      setRejectTarget(null);
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
      {rejectTarget && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="admin-table-head">Tolak pengajuan KYC — {rejectTarget.fullName}</div>
          <label className="label" htmlFor="kyc-reject-reason">
            Alasan penolakan (wajib, maks. 1000 karakter — dicatat di audit log)
          </label>
          <textarea
            id="kyc-reject-reason"
            className="input"
            rows={2}
            maxLength={1000}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex-gap-6" style={{ marginTop: 8 }}>
            <button
              className="btn-gold admin-mini"
              onClick={confirmReject}
              disabled={busy || normalizeKycRejectReason(rejectReason) === null}
            >
              Tolak
            </button>
            <button className="btn-ghost admin-mini" onClick={() => setRejectTarget(null)} disabled={busy}>
              Batal
            </button>
          </div>
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
                            <button className="btn-gold admin-mini" onClick={() => decide(view.id)} disabled={busy}>
                              Setujui
                            </button>
                            <button className="btn-ghost admin-mini" onClick={() => startReject(row)} disabled={busy}>
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
