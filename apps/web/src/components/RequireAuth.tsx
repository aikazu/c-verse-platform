import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Gate halaman yang butuh auth. Setelah login sukses, user kembali ke
 * halaman asal (location.state.from) — pola ini menghindari dead-end
 * deep-link dan konsolidasi copy "Masuk dulu" yang sebelumnya tercecer
 * di tiap halaman (audit P1-1).
 *
 * Behavior:
 * - user undefined (auth masih loading): tampilkan placeholder netral agar
 *   tidak flash ke prompt "Masuk" saat Supabase restore session.
 * - user null saat sudah selesai loading: <Navigate> ke /login dengan
 *   state.from = current path.
 * - user ada: render children.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="card card-pad muted" style={{ textAlign: "center", padding: 24, fontFamily: "var(--font-mono)", fontSize: 12 }}>
        Memuat…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Standalone prompt untuk halaman yang tidak membungkus RequireAuth (mis.
 * komponen yang dipanggil inline seperti `onBid` di Browse). Konsisten
 * dengan copy di halaman lain — pakai "Masuk untuk ..." yang sama.
 */
export function LoginPrompt({ action }: { action: string }) {
  return (
    <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
      <p className="muted" style={{ marginTop: 8 }}>
        {action}
      </p>
      <Link to="/login" style={{ color: "var(--gold)", fontSize: 13, fontWeight: 600, marginTop: 10, display: "inline-block" }}>
        Masuk →
      </Link>
    </div>
  );
}
