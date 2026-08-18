import { kycStatusLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function Kyc() {
  const { push } = useToast();
  const { data, refetch } = useQuery({ queryKey: ["kyc"], queryFn: () => api.kyc() });
  const kyc: any = (data as any)?.kyc;
  const [fullName, setFullName] = useState("");
  const [nik, setNik] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  async function onSubmit() {
    if (fullName.length < 2 || nik.length !== 16 || address.length < 10) {
      push("Lengkapi nama, NIK 16 digit, dan alamat", "info");
      return;
    }
    setSaving(true);
    try {
      await api.submitKyc({ fullName, nik, address });
      push("Verifikasi terkirim — menunggu persetujuan", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <span className="eyebrow">Verifikasi</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Verifikasi <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Identitas</em>
        </h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Diperlukan untuk payout ke rekening (disbursement IDR). Tidak diperlukan untuk pasang harga jual atau terima penawaran — hanya
          untuk penarikan hasil penjualan.
        </p>
      </div>
      <div className="card card-pad">
        {kyc ? (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 10,
              background:
                kyc.status === "approved" ? "var(--signal-bg)" : kyc.status === "rejected" ? "var(--alert-bg)" : "var(--gold-bg-soft)",
              border: `1px solid ${kyc.status === "approved" ? "var(--signal-border)" : kyc.status === "rejected" ? "var(--alert-border)" : "var(--gold-border)"}`,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: kyc.status === "approved" ? "var(--signal)" : kyc.status === "rejected" ? "var(--alert)" : "var(--gold)",
              }}
            >
              {kycStatusLabel(kyc.status)}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>
              {kyc.fullName ?? "—"} · {kyc.nik ?? ""}
            </div>
            {kyc.status === "pending" && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Menunggu verifikasi
              </div>
            )}
            {kyc.status === "rejected" && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Ditolak — silakan ajukan ulang
              </div>
            )}
          </div>
        ) : (
          <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Belum ada pengajuan
          </div>
        )}
      </div>
      {kyc?.status !== "approved" && (
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Ajukan Verifikasi</div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-fullname">
              Nama lengkap
            </label>
            <input id="kyc-fullname" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-nik">
              NIK — 16 digit
            </label>
            <input
              id="kyc-nik"
              className="input"
              value={nik}
              inputMode="numeric"
              onChange={(e) => setNik(e.target.value.replace(/\D/g, "").slice(0, 16))}
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-address">
              Alamat
            </label>
            <textarea id="kyc-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
          </div>
          <button className="btn-gold" onClick={onSubmit} disabled={saving} style={{ width: "100%", padding: "12px" }}>
            {saving ? "Mengirim…" : "Kirim"}
          </button>
        </div>
      )}
    </div>
  );
}
