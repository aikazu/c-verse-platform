import { kycStatusLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiKycResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const NIK_RE = /^\d{16}$/;

/**
 * Parse NIK → kode wilayah (6 digit) + tanggal lahir (6 digit DDMMYY, perempuan
 * +40 untuk hari) + urutan (4 digit). Mengembalikan null bila NIK tidak valid.
 *
 * Validasi ringan (format). Checksum KTP sebenarnya ada (provinsi/kabupaten/kecamatan/
 * tanggal + urutan + checksum digit terakhir) tapi belum diimplementasi MVP —
 * validasi akhir oleh review admin. Tujuannya hanya client-side error early.
 */
function parseNik(nik: string): { province: string; dobDDMMYY: string; sequence: string } | null {
  if (!NIK_RE.test(nik)) return null;
  const ddmmyy = nik.slice(6, 12);
  let dd = Number.parseInt(ddmmyy.slice(0, 2), 10);
  if (dd > 40) dd -= 40; // perempuan: hari + 40
  const mm = ddmmyy.slice(2, 4);
  const yy = ddmmyy.slice(4, 6);
  return {
    province: nik.slice(0, 6),
    dobDDMMYY: `${String(dd).padStart(2, "0")}${mm}${yy}`,
    sequence: nik.slice(12, 16),
  };
}

/** Upload satu file ke bucket kyc-files (private). Mengembalikan path storage;
 *  route /api/kyc menerima URL absolut hasil sign. */
async function uploadKycFile(userId: string, kind: "ktp" | "selfie" | "npwp", file: File): Promise<string> {
  if (!supabase) throw new Error("Supabase belum terkonfigurasi");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("kyc-files").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  // Simpan path; service-role admin yang menandatangani URL saat review (lihat M5 + 11_rls).
  // Untuk MVP, simpan path publik (signed URL on read by admin via separate endpoint).
  return path;
}

export default function Kyc() {
  return (
    <RequireAuth>
      <KycInner />
    </RequireAuth>
  );
}

function KycInner() {
  const { user } = useAuth();
  const { push } = useToast();
  const { data, refetch } = useQuery<ApiKycResponse>({ queryKey: ["kyc"], queryFn: () => api.kyc() });
  const kyc = data?.kyc;
  const [fullName, setFullName] = useState("");
  const [nik, setNik] = useState("");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState("");
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [npwpFile, setNpwpFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const nikInfo = parseNik(nik);

  async function onSubmit() {
    if (!user) return;
    if (fullName.length < 2 || !NIK_RE.test(nik) || address.length < 10 || !dob || !ktpFile || !selfieFile) {
      push("Lengkapi nama, NIK 16 digit, alamat, tanggal lahir, foto KTP, selfie", "info");
      return;
    }
    if (!user.id) {
      push("Akun tidak valid — login ulang", "error");
      return;
    }
    setSaving(true);
    try {
      setUploading(true);
      const [ktpPath, selfiePath] = await Promise.all([
        uploadKycFile(user.id, "ktp", ktpFile),
        uploadKycFile(user.id, "selfie", selfieFile),
      ]);
      const npwpPath = npwpFile ? await uploadKycFile(user.id, "npwp", npwpFile) : undefined;
      setUploading(false);
      await api.submitKyc({
        fullName,
        nik,
        address,
        dob,
        ktpUrl: ktpPath,
        selfieUrl: selfiePath,
        npwpUrl: npwpPath,
      });
      push("Verifikasi terkirim — menunggu persetujuan", "success");
      refetch();
    } catch (e: unknown) {
      setUploading(false);
      push(errorMessage(e), "error");
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
              Nama lengkap (sesuai KTP)
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
            {nik.length === 16 && nikInfo && (
              <div
                className="muted"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  marginTop: 4,
                  color: "var(--text-dim)",
                }}
              >
                Valid → {nikInfo.province} / {nikInfo.dobDDMMYY} / {nikInfo.sequence}
              </div>
            )}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-dob">
              Tanggal lahir (sesuai KTP)
            </label>
            <input
              id="kyc-dob"
              type="date"
              className="input"
              value={dob}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDob(e.target.value)}
            />
            {dob && nikInfo && (
              <div
                className="muted"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  marginTop: 4,
                  color:
                    dob === `19${nikInfo.dobDDMMYY.slice(4, 6)}-${nikInfo.dobDDMMYY.slice(2, 4)}-${nikInfo.dobDDMMYY.slice(0, 2)}`
                      ? "var(--signal)"
                      : "var(--text-dim)",
                }}
              >
                Cocok dengan NIK
              </div>
            )}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-address">
              Alamat
            </label>
            <textarea id="kyc-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-ktp">
              Foto KTP <span style={{ color: "var(--alert)", fontFamily: "var(--font-mono)", fontSize: 10 }}>wajib</span>
            </label>
            <input
              id="kyc-ktp"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setKtpFile(e.target.files?.[0] ?? null)}
            />
            {ktpFile && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 4 }}>
                {ktpFile.name} · {(ktpFile.size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-selfie">
              Selfie dengan KTP <span style={{ color: "var(--alert)", fontFamily: "var(--font-mono)", fontSize: 10 }}>wajib</span>
            </label>
            <input
              id="kyc-selfie"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
            />
            {selfieFile && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 4 }}>
                {selfieFile.name} · {(selfieFile.size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="kyc-npwp">
              NPWP (opsional — untuk withhold pajak 23)
            </label>
            <input
              id="kyc-npwp"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setNpwpFile(e.target.files?.[0] ?? null)}
            />
            {npwpFile && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 4 }}>
                {npwpFile.name} · {(npwpFile.size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
          <button className="btn-gold" onClick={onSubmit} disabled={saving || uploading} style={{ width: "100%", padding: "12px" }}>
            {uploading ? "Mengunggah…" : saving ? "Mengirim…" : "Kirim"}
          </button>
        </div>
      )}
    </div>
  );
}
