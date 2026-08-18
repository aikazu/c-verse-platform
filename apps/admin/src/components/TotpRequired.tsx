import { useState } from "react";
import { supabase } from "../lib/supabase";

export function TotpRequired({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onEnroll() {
    setMsg(null);
    const { error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) setMsg(error.message);
    else setMsg("Authenticator terdaftar — pindai QR di app authenticator kamu, lalu masukkan kodenya di sini.");
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp[0] ?? factors?.all[0];
      if (!factor) {
        setMsg("Belum ada authenticator — klik Daftar Authenticator dulu.");
        return;
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError || !challenge) {
        setMsg(challengeError?.message ?? "Gagal membuat challenge TOTP");
        return;
      }
      const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
      if (error) {
        setMsg(error.message);
        return;
      }
      onVerified();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-login-card" style={{ borderLeft: "4px solid #eab308" }}>
        <h3 style={{ fontWeight: 800 }}>Verifikasi dua langkah (aal1 → aal2)</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Login berhasil (aal1) — sesi kamu terbatas sebagai view-only. Selesaikan kode TOTP untuk membuka dashboard &amp; mutasi (aal2).
        </p>
        <form onSubmit={onVerify} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <div>
            <label className="label">Kode TOTP (6 digit)</label>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: 2, textAlign: "center", fontSize: 15 }}
            />
          </div>
          <button className="btn-gold" type="submit" disabled={busy || code.length < 6} style={{ padding: "11px" }}>
            {busy ? "Memverifikasi…" : "Verifikasi Kode"}
          </button>
          <button className="btn-ghost" type="button" onClick={onEnroll} style={{ fontSize: 12 }}>
            Daftar Authenticator
          </button>
        </form>
        {msg && <div className="admin-msg">{msg}</div>}
        <div className="mono meta" style={{ marginTop: 10 }}>
          Break-glass: admin lain yang sudah aal2 dapat mereset enrollment yang hilang — tercatat di audit log.
        </div>
      </div>
    </div>
  );
}
