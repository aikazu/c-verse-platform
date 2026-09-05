import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { safeAppPath } from "../lib/auth-continuation";
import { useToast } from "../lib/toast";
import { isTurnstileEnabled, mountTurnstile, type TurnstileHandle } from "../lib/turnstile";
import "./creator-console.css";

// Akun seed (supabase/seeds/*.sql) untuk one-click login masa demo lokal.
const DEMO_ACCOUNTS = [
  { label: "User", email: "demo@cverse.id" },
  { label: "Creator", email: "karina@creator.id" },
] as const;

// Auth tunggal (docs/10): Google OAuth + email OTP 6 digit + Turnstile.
// Karena cuma magic-link & OAuth, TIDAK ada pemisahan login vs register:
//   - email belum ada  → akun baru dibuat (otomatis)
//   - email sudah ada  → masuk ke akun tersebut (otomatis)
// Satu alur, dijalankan dari email + Google.
//
// Setelah verifikasi sukses, redirect ke `location.state.from` bila RequireAuth
// pre-redirect user yang deep-link (mis. /home, /me/manage, /orders). Default: /home.

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Jeda kirim-ulang OTP: 30 detik setelah kirim pertama, berlipat 2x tiap kirim sukses, mentok 5 menit.
const RESEND_BASE_SECONDS = 30;
const RESEND_MAX_SECONDS = 300;

function redirectTarget(state: unknown): string {
  if (state && typeof state === "object" && "from" in state) {
    const from = (state as { from?: unknown }).from;
    return safeAppPath(from, window.location.origin) ?? "/home";
  }
  return "/home";
}

export default function AuthForm() {
  const { loginGoogle, sendOtp, verifyOtp, verifyMagicLink, isSupabaseAuth } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const location = useLocation();
  const target = redirectTarget(location.state);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [resendIn, setResendIn] = useState(0);
  const resendDelayRef = useRef(RESEND_BASE_SECONDS);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileRefHandle = useRef<TurnstileHandle | null>(null);

  // Widget di-mount sekali dan hidup di KEDUA layar (request + kode) — token Turnstile
  // single-use per kirim, jadi layar kode juga butuh widget untuk token resend yang segar.
  useEffect(() => {
    let destroyed = false;
    if (turnstileRef.current && !turnstileRefHandle.current) {
      mountTurnstile(turnstileRef.current, setCaptchaToken, () => setCaptchaToken(undefined)).then((handle) => {
        if (destroyed) handle.destroy();
        else turnstileRefHandle.current = handle;
      });
    }
    return () => {
      destroyed = true;
      turnstileRefHandle.current?.destroy();
      turnstileRefHandle.current = null;
    };
  }, []);

  // Tick mundur 1 detik; timer dibuat ulang tiap tick — tak ada interval yang bocor.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function sendCode() {
    if (isTurnstileEnabled && !captchaToken) {
      push("Selesaikan captcha dulu", "error");
      return;
    }
    setBusy(true);
    try {
      // full_name dipakai saat akun BARU dibuat; email existing diabaikan (login).
      await sendOtp(email, turnstileRefHandle.current?.token(), displayName.trim() ? displayName : undefined);
      setOtpSent(true);
      setResendIn(resendDelayRef.current);
      resendDelayRef.current = Math.min(resendDelayRef.current * 2, RESEND_MAX_SECONDS);
      // Token terpakai oleh kirim yang sukses — reset agar kirim berikutnya punya token segar.
      turnstileRefHandle.current?.reset();
      setCaptchaToken(undefined);
      push(`Kode 6 digit dikirim ke ${email}`, "success");
    } catch (err: unknown) {
      // Token Turnstile single-use — reset agar percobaan berikutnya punya token baru.
      turnstileRefHandle.current?.reset();
      setCaptchaToken(undefined);
      push(errorMessage(err) || "Gagal mengirim kode", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    await sendCode();
  }

  async function onResend() {
    await sendCode();
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyOtp(email, code);
      push("Berhasil masuk", "success");
      nav(target, { replace: true });
    } catch (err: unknown) {
      push(errorMessage(err) || "Kode salah atau kedaluwarsa", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      // OAuth kembali ke origin yang diizinkan Supabase; AuthProvider memulihkan
      // continuation app-local hanya setelah sesi dan profil siap.
      await loginGoogle(target);
    } catch (err: unknown) {
      push(errorMessage(err) || "Gagal membuka Google", "error");
      setBusy(false);
    }
  }

  // DEV ONLY — POST /api/auth/demo-login → token_hash → sesi (tanpa OTP/captcha).
  // Butuh ENABLE_DEMO_LOGIN=1 di API; di production tombol ini tidak pernah ikut bundle.
  async function onDemoLogin(demoEmail: string) {
    setBusy(true);
    try {
      const { tokenHash } = await api.demoLogin(demoEmail);
      await verifyMagicLink(tokenHash);
      push(`Masuk sebagai ${demoEmail}`, "success");
      nav(target, { replace: true });
    } catch (err: unknown) {
      push(errorMessage(err) || "Demo login gagal — cek API jalan dengan ENABLE_DEMO_LOGIN=1", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-auth">
      <div className="card cx-auth-card">
        <div className="cx-brand">
          <div className="cx-brand-name">
            C<span style={{ color: "var(--gold)" }}>.</span>Verse
          </div>
          <h1 className="cx-brand-tag">Masuk / Daftar</h1>
        </div>

        {!isSupabaseAuth && (
          <div className="muted" style={{ fontSize: 12 }}>
            Layanan masuk belum tersedia. Silakan coba lagi nanti.
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

        <div className="cx-divider" />

        <div ref={turnstileRef} />

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
            <button
              className="btn-gold"
              disabled={busy || !isSupabaseAuth || (isTurnstileEnabled && !captchaToken)}
              style={{ padding: "12px", width: "100%" }}
            >
              {busy ? "Memproses…" : "Kirim kode masuk ke email"}
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
            <button
              type="button"
              className="btn-ghost"
              onClick={onResend}
              disabled={busy || resendIn > 0 || (isTurnstileEnabled && !captchaToken)}
              style={{ padding: "11px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              {resendIn > 0 ? `Kirim ulang kode (${resendIn}s)` : "Kirim ulang kode"}
            </button>
          </form>
        )}
        {import.meta.env.DEV && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="muted" style={{ fontSize: 11, textAlign: "center", letterSpacing: "0.08em" }}>
              DEMO — ONE-CLICK LOGIN (LOKAL)
            </div>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                className="btn-ghost"
                onClick={() => onDemoLogin(account.email)}
                disabled={busy || !isSupabaseAuth}
                style={{ padding: "9px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
              >
                Masuk sebagai {account.label} — {account.email}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
