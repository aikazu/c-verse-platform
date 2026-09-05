import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import { isTurnstileEnabled, mountTurnstile, type TurnstileHandle } from "../lib/turnstile";

// Akun seed admin (supabase/seeds/*.sql) — one-click login masa demo lokal (DEV only).
const DEMO_ADMIN_EMAIL = "admin@cverse.id";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileHandleRef = useRef<TurnstileHandle | null>(null);

  useEffect(() => {
    let destroyed = false;
    if (turnstileRef.current && !turnstileHandleRef.current) {
      mountTurnstile(turnstileRef.current, setCaptchaToken, () => setCaptchaToken(undefined)).then((handle) => {
        if (destroyed) handle.destroy();
        else turnstileHandleRef.current = handle;
      });
    }
    return () => {
      destroyed = true;
      turnstileHandleRef.current?.destroy();
      turnstileHandleRef.current = null;
    };
  }, []);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (isTurnstileEnabled && !captchaToken) {
      setMsg("Selesaikan captcha dulu.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin, captchaToken },
      });
      if (error) setMsg(error.message);
      else setMsg("Tautan masuk terkirim — cek email (Inbucket di dev).");
      // Token single-use dan widget tetap terlihat di form ini — reset agar retry punya token baru.
      turnstileHandleRef.current?.reset();
      setCaptchaToken(undefined);
    } finally {
      setBusy(false);
    }
  }

  // DEV ONLY — POST /api/auth/demo-login → token_hash → sesi passwordless tanpa email OTP/captcha.
  // Butuh ENABLE_DEMO_LOGIN=1 di API; di production build tombol ini tidak pernah ikut bundle.
  async function onDemoLogin() {
    setBusy(true);
    setMsg(null);
    try {
      const { tokenHash } = await apiFetch<{ email: string; tokenHash: string }>("/api/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ email: DEMO_ADMIN_EMAIL }),
      });
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error) throw new Error(error.message);
      setMsg("Sesi demo aktif (dev)…");
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Demo login gagal");
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
          Hanya untuk pengelola platform — masuk dengan tautan OTP email. Akses mengikuti peran akun.
        </p>

        <form onSubmit={onLogin} className="flex-gap-8" style={{ flexDirection: "column" }}>
          <div>
            <label className="label" htmlFor="admin-login-email">
              Email
            </label>
            <input
              id="admin-login-email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cverse.id"
              autoComplete="email"
            />
          </div>
          <div ref={turnstileRef} />
          <button
            className="btn-gold"
            type="submit"
            disabled={busy || (isTurnstileEnabled && !captchaToken)}
            style={{ marginTop: 6, padding: "11px", width: "100%" }}
          >
            {busy ? "Mengirim…" : "Kirim Tautan Masuk"}
          </button>
        </form>

        {msg && (
          <div className="admin-msg" role="status" aria-live="polite">
            {msg}
          </div>
        )}

        {import.meta.env.DEV && (
          <button
            type="button"
            className="btn-ghost"
            onClick={onDemoLogin}
            disabled={busy}
            style={{ marginTop: 12, padding: "9px", width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            DEMO — Masuk sebagai {DEMO_ADMIN_EMAIL}
          </button>
        )}

        <div className="admin-login-help">Akses belum tersedia? Hubungi super admin.</div>
      </div>
    </div>
  );
}
