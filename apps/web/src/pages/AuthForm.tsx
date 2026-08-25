import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { isTurnstileEnabled, mountTurnstile, type TurnstileHandle } from "../lib/turnstile";

// Auth tunggal (docs/10): Google OAuth + email OTP 6 digit + Turnstile.
// Karena cuma magic-link & OAuth, TIDAK ada pemisahan login vs register:
//   - email belum ada  → akun baru dibuat (otomatis)
//   - email sudah ada  → masuk ke akun tersebut (otomatis)
// Satu alur, dijalankan dari email + Google.

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function AuthForm() {
  const { loginGoogle, sendOtp, verifyOtp, isSupabaseAuth } = useAuth();
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
      // full_name dipakai saat akun BARU dibuat; email existing diabaikan (login).
      await sendOtp(email, turnstileRefHandle.current?.token(), displayName.trim() ? displayName : undefined);
      setOtpSent(true);
      push(`Kode 6 digit dikirim ke ${email}`, "success");
    } catch (err: unknown) {
      push(errorMessage(err) || "Gagal mengirim kode", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyOtp(email, code);
      push("Berhasil masuk", "success");
      nav("/drops");
    } catch (err: unknown) {
      push(errorMessage(err) || "Kode salah atau kedaluwarsa", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      await loginGoogle(); // redirect ke Google; onAuthStateChange menangani session
    } catch (err: unknown) {
      push(errorMessage(err) || "Gagal membuka Google", "error");
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
            Masuk / Daftar — C.Card pertamamu menanti
          </div>
        </div>

        {!isSupabaseAuth && (
          <div className="muted" style={{ fontSize: 12 }}>
            Supabase belum terkonfigurasi — set VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY untuk masuk.
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
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="auth-email">
                Email
              </label>
              <input id="auth-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="auth-displayname">
                Nama tampilan (opsional — untuk akun baru)
              </label>
              <input
                id="auth-displayname"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Cara dipanggil di C.Verse"
              />
            </div>
            <div ref={turnstileRef} />
            <button className="btn-gold" disabled={busy || !isSupabaseAuth} style={{ padding: "12px", width: "100%" }}>
              {busy ? "Memproses…" : "Kirim kode OTP (email)"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="label" htmlFor="auth-code">
                Kode 6 digit ({email})
              </label>
              <input
                id="auth-code"
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
      </div>
    </div>
  );
}
