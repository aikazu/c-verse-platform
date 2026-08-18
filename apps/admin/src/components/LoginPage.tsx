import { useState } from "react";
import { supabase } from "../lib/supabase";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
      });
      if (error) setMsg(error.message);
      else setMsg("Tautan masuk terkirim — cek email (Inbucket di dev).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <div className="admin-login-logo">
            C<span>.</span>Verse
          </div>
          <div className="admin-login-sub">Admin</div>
        </div>
        <h1 className="admin-login-title">Masuk</h1>
        <p className="muted fs-12 align-center" style={{ marginBottom: 18 }}>
          Hanya untuk pengelola platform — verifikasi TOTP diminta setelah login.
        </p>

        <form onSubmit={onLogin} className="flex-gap-8" style={{ flexDirection: "column" }}>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cverse.id"
              autoComplete="email"
            />
          </div>
          <button className="btn-gold" type="submit" disabled={busy} style={{ marginTop: 6, padding: "11px", width: "100%" }}>
            {busy ? "Mengirim…" : "Kirim Tautan Masuk"}
          </button>
        </form>

        {msg && <div className="admin-msg">{msg}</div>}

        <div style={{ fontSize: 11, color: "var(--dim)", textAlign: "center", marginTop: 16 }}>
          Butuh bantuan? Hubungi super admin untuk reset.
        </div>
      </div>
    </div>
  );
}