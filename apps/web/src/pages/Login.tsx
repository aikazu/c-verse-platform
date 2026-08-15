import type React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Login() {
  const { login, demoLogin } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email, setEmail] = useState("demo@cverse.id");
  const [pass, setPass] = useState("demo123");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, pass);
      push("Masuk berhasil", "success");
      nav("/drops");
    } catch (err: any) {
      push(err.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function onDemo() {
    setBusy(true);
    try {
      await demoLogin();
      push("Demo login berhasil", "success");
      nav("/drops");
    } catch (err: any) {
      push(err.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ maxWidth: 420, margin: "48px auto", padding: "0 16px" }}>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 18, padding: 28 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>
            C<span style={{ color: "var(--gold)" }}>.</span>Verse
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              marginTop: 4,
            }}
          >
            Masuk
          </div>
        </div>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Password</label>
            <input className="input" value={pass} onChange={(e) => setPass(e.target.value)} type="password" required />
          </div>
          <button className="btn-gold" disabled={busy} style={{ padding: "12px", width: "100%" }}>
            {busy ? "Memproses…" : "Masuk"}
          </button>
        </form>
        <div style={{ height: 1, background: "var(--border)" }} />
        <button
          className="btn-ghost"
          onClick={onDemo}
          disabled={busy}
          style={{ padding: "11px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          ⚡ Demo — 1 klik
        </button>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          Belum punya akun?{" "}
          <Link to="/register" style={{ color: "var(--gold)", fontWeight: 600 }}>
            Daftar
          </Link>
        </div>
      </div>
    </div>
  );
}
