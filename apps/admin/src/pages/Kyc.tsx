import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch, apiFetchBlob } from "../lib/api";
import { errMessage } from "../lib/utils";
import { buildKycRejectBody, kycRejectConfirmMessage, normalizeKycRejectReason } from "./kycReject";
import { type KycAdminRow, kycRowToDisplay } from "./kycRows";

type DocumentKind = "ktp" | "selfie" | "npwp";
type ReviewDocument = { url: string; contentType: string };

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  ktp: "KTP",
  selfie: "Selfie dengan KTP",
  npwp: "NPWP",
};

function DocumentPreview({ kind, document }: { kind: DocumentKind; document?: ReviewDocument }) {
  return (
    <div className="kyc-document">
      <div className="kyc-document-label">{DOCUMENT_LABELS[kind]}</div>
      {document ? (
        document.contentType === "application/pdf" ? (
          <a className="btn-ghost admin-mini" href={document.url} target="_blank" rel="noreferrer">
            Buka PDF
          </a>
        ) : (
          <a href={document.url} target="_blank" rel="noreferrer" aria-label={`Buka ${DOCUMENT_LABELS[kind]}`}>
            <img className="kyc-document-image" src={document.url} alt={DOCUMENT_LABELS[kind]} />
          </a>
        )
      ) : (
        <span className="muted fs-11">Tidak tersedia</span>
      )}
    </div>
  );
}

export function KycPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<KycAdminRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<KycAdminRow | null>(null);
  const [reviewDocuments, setReviewDocuments] = useState<Partial<Record<DocumentKind, ReviewDocument>>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
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
    void load();
  }, []);

  useEffect(() => {
    if (!reviewTarget) {
      setReviewDocuments({});
      return;
    }
    let active = true;
    const objectUrls: string[] = [];
    const availableKinds = (Object.keys(reviewTarget.documents) as DocumentKind[]).filter((kind) => reviewTarget.documents[kind]);
    setReviewLoading(true);
    setMsg(null);
    Promise.all(
      availableKinds.map(async (kind) => {
        const blob = await apiFetchBlob(`/api/kyc/admin/${reviewTarget.id}/files/${kind}`);
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return [kind, { url, contentType: blob.type }] as const;
      }),
    )
      .then((documents) => {
        if (active) setReviewDocuments(Object.fromEntries(documents));
      })
      .catch((err) => {
        if (active) setMsg(errMessage(err));
      })
      .finally(() => {
        if (active) setReviewLoading(false);
      });
    return () => {
      active = false;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [reviewTarget]);

  async function decide(id: string) {
    if (
      !(await confirm({
        title: "Setujui pengajuan KYC ini?",
        message: "User bisa menerima payout setelah disetujui. Pastikan KTP, selfie, NIK, dan tanggal lahir sudah cocok.",
        confirmLabel: "Setujui",
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/kyc/${id}/approve`, { method: "POST" });
      setMsg(`KYC ${id.slice(0, 8)} disetujui`);
      setReviewTarget(null);
      await load();
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
      setReviewTarget(null);
      await load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const requiredDocumentsLoaded = Boolean(reviewDocuments.ktp && reviewDocuments.selfie);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>KYC</h2>
        <p className="muted">Review identitas payout melalui dokumen privat Cloudflare R2; setiap akses ter-audit</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      {reviewTarget && (
        <section className="card card-pad kyc-review" aria-label={`Review KYC ${reviewTarget.fullName}`}>
          <div className="kyc-review-head">
            <div>
              <div className="admin-table-head kyc-review-title">Review pengajuan — {reviewTarget.fullName}</div>
              <div className="muted fs-11">ID {reviewTarget.id}</div>
            </div>
            <button className="btn-ghost admin-mini" onClick={() => setReviewTarget(null)} disabled={busy}>
              Tutup
            </button>
          </div>
          <dl className="kyc-identity-grid">
            <div>
              <dt>NIK</dt>
              <dd className="mono">{reviewTarget.nik}</dd>
            </div>
            <div>
              <dt>Tanggal lahir</dt>
              <dd>{reviewTarget.dob ?? "—"}</dd>
            </div>
            <div className="kyc-address-row">
              <dt>Alamat</dt>
              <dd>{reviewTarget.address}</dd>
            </div>
          </dl>
          {reviewLoading ? (
            <div className="muted fs-11">Memuat dokumen privat…</div>
          ) : (
            <div className="kyc-document-grid">
              <DocumentPreview kind="ktp" document={reviewDocuments.ktp} />
              <DocumentPreview kind="selfie" document={reviewDocuments.selfie} />
              {reviewTarget.documents.npwp && <DocumentPreview kind="npwp" document={reviewDocuments.npwp} />}
            </div>
          )}
          {reviewTarget.status === "pending" && (
            <div className="flex-gap-6">
              <button
                className="btn-gold admin-mini"
                onClick={() => decide(reviewTarget.id)}
                disabled={busy || reviewLoading || !requiredDocumentsLoaded}
              >
                Setujui
              </button>
              <button className="btn-ghost admin-mini" onClick={() => startReject(reviewTarget)} disabled={busy}>
                Tolak
              </button>
            </div>
          )}
        </section>
      )}
      {rejectTarget && (
        <div className="card card-pad">
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
            onChange={(event) => setRejectReason(event.target.value)}
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
                      <td>
                        <button className="btn-ghost admin-mini" onClick={() => setReviewTarget(row)} disabled={busy}>
                          Review
                        </button>
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
