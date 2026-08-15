import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { isTurnstileEnabled, mountTurnstile, type TurnstileHandle } from "../lib/turnstile";

// Login/Register via Supabase Auth (docs/10): Google OAuth + email OTP 6 digit + Turnstile.
const DEMO_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEMO_LOGIN === "1";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { loginGoogle, sendOtp, verifyOtp, demoLogin, isSupabaseAuth } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileRefHandle = useRef<TurnstileHandle | null>(null);

  useEffect(() => {
    let destroyed = false;
    if (otpSent && turnstileRef.current && !turnstileRefHandle.current) {
      mountTurnstile(turnstileRef.current).then((handle) => {
        if (destroyed) handle.destroy();
        else turnstileRefHandle.current = handle;
      });
    }
    return () => {
      destroyed = true;
      turnstileRefHandle.current?.destroy();
      turnstileRefHandle.current = null;
    };
  }, [otpSent]);

  async function onRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (isTurnstileEnabled && turnstileRefHandle.current && !turnstileRefHandle.current.token()) {
      push("Selesaikan captcha dulu", "error");
      return;
    }
    setBusy(true);
    try {
      await sendOtp(email, turnstileRefHandle.current?.token(), mode === "register" ? displayName : undefined);
      setOtpSent(true);
      push(`Kode 6 digit dikirim ke ${email}`, "success");
    } catch (err: any) {
      push(err.message ?? "Gagal mengirim kode", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyOtp(email, code);
      push(mode === "register" ? "Akun dibuat — selamat datang!" : "Masuk berhasil", "success");
      nav("/drops");
    } catch (err: any) {
      push(err.message ?? "Kode salah atau kedaluwarsa", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      await loginGoogle(); // redirect ke Google; onAuthStateChange menangani session
    } catch (err: any) {
      push(err.message ?? "Gagal membuka Google", "error");
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
      push(err.message ?? "Demo login gagal", "error");
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
            {mode === "register" ? "Daftar" : "Masuk"}
          </div>
        </div>

        {!isSupabaseAuth && (
          <div className="muted" style={{ fontSize: 12 }}>
            Mode dev tanpa Supabase — login Google/OTP tidak aktif. {DEMO_LOGIN_ENABLED ? "Gunakan demo login di bawah." : ""}
          </div>
        )}

        <button
          className="btn-ghost"
          onClick={onGoogle}
          disabled={busy || !isSupabaseAuth}
          style={{ padding: "11px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          Lanjutkan dengan Google
        </button>

        <div style={{ height: 1, background: "var(--border)" }} />

        {!otpSent ? (
          <form onSubmit={onRequestOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "register" && (
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="label">Nama tampilan</label>
                <input
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required={mode === "register"}
                />
              </div>
            )}
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="label">Email</label>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
            <div ref={turnstileRef} />
            <button className="btn-gold" disabled={busy || !isSupabaseAuth} style={{ padding: "12px", width: "100%" }}>
              {busy ? "Memproses…" : "Kirim kode OTP (email)"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="label">Kode 6 digit ({email})</label>
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                pattern="\d{6}"
                style={{ letterSpacing: "0.4em", textAlign: "center", fontFamily: "var(--font-mono)" }}
                required
              />
            </div>
            <button className="btn-gold" disabled={busy || code.length !== 6} style={{ padding: "12px", width: "100%" }}>
              {busy ? "Memverifikasi…" : "Verifikasi & Masuk"}
            </button>
          </form>
        )}

        {DEMO_LOGIN_ENABLED && (
          <>
            <div style={{ height: 1, background: "var(--border)" }} />
            <button
              className="btn-ghost"
              onClick={onDemo}
              disabled={busy}
              style={{ padding: "11px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              ⚡ Demo — 1 klik
            </button>
          </>
        )}
      </div>
    </div>
  );
}
