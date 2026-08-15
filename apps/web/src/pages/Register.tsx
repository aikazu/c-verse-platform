import type React from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Register() {
  const { register } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(email, pass, name);
      push("Akun dibuat", "success");
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
            Buat akun
          </div>
        </div>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Nama tampilan</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Password</label>
            <input className="input" value={pass} onChange={(e) => setPass(e.target.value)} type="password" required minLength={6} />
          </div>
          <button className="btn-gold" disabled={busy} style={{ padding: "12px", width: "100%" }}>
            {busy ? "Memproses…" : "Daftar"}
          </button>
        </form>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          Sudah punya akun?{" "}
          <Link to="/login" style={{ color: "var(--gold)", fontWeight: 600 }}>
            Masuk
          </Link>
        </div>
      </div>
    </div>
  );
}
