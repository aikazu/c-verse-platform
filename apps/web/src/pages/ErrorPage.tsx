import { useLocation, useNavigate } from "react-router-dom";

// Error page arcade (docs/02 tone of voice): informatif — WHAT happened,
// WHY kemungkinan, WHAT yang bisa dilakukan — plus detail teknis yang bisa
// dibuka untuk laporan bug. Dipakai oleh route catch-all (404) dan
// ErrorBoundary (500 / crash render).

export interface ErrorPageProps {
  code: number;
  title: string;
  message: string;
  hint?: string;
  /** Detail teknis (stack / error message) — collapsible, untuk laporan bug. */
  detail?: string | null;
  /** Label retry — dipakai ErrorBoundary untuk reset state tanpa reload penuh. */
  onRetry?: () => void;
}

const CODE_LABELS: Record<number, string> = {
  400: "BAD REQUEST",
  401: "UNAUTHORIZED",
  403: "ACCESS DENIED",
  404: "NOT FOUND",
  429: "TOO MANY REQUESTS",
  500: "SYSTEM ERROR",
  502: "SERVER UNREACHABLE",
  503: "MAINTENANCE",
};

export default function ErrorPage({ code, title, message, hint, detail, onRetry }: ErrorPageProps) {
  const nav = useNavigate();
  const codeLabel = CODE_LABELS[code] ?? "ERROR";
  return (
    <section className="error-page" role="alert" aria-live="assertive">
      <div className="error-stage" aria-hidden="true">
        <span className="error-code" data-code={code}>
          {code}
        </span>
        <span className="error-code-label">{codeLabel}</span>
      </div>
      <h1 className="error-title">{title}</h1>
      <p className="error-message">{message}</p>
      {hint && <p className="error-hint">{hint}</p>}
      <div className="error-actions">
        <button className="btn-gold" onClick={() => nav("/")}>
          ◀ Insert Coin — Home
        </button>
        {onRetry ? (
          <button className="btn-ghost" onClick={onRetry}>
            ↻ Coba Lagi
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => window.location.reload()}>
            ↻ Muat Ulang
          </button>
        )}
        <button className="btn-ghost" onClick={() => nav("/drops")}>
          Lihat Drops
        </button>
      </div>
      {detail != null && detail.trim() !== "" && (
        <details className="error-detail">
          <summary>Detail teknis (untuk laporan bug)</summary>
          <pre>{detail}</pre>
          <p className="error-detail-meta">Sertakan blok ini + URL saat melapor — mempercepat diagnosis.</p>
        </details>
      )}
    </section>
  );
}

/** Route catch-all — unknown path = 404 informatif dengan path yang diminta. */
export function NotFoundPage() {
  const location = useLocation();
  return (
    <ErrorPage
      code={404}
      title="Kartu Tidak Ditemukan di Deck"
      message={`Halaman "${location.pathname}" tidak ada — mungkin link salah, drop sudah closed, atau kartu dipindahkan.`}
      hint="Cek kembali link dari seller/creator, atau kembali ke beranda dan telusuri drops yang sedang live."
      detail={`path: ${location.pathname}\nsearch: ${location.search || "-"}\nreferrer: ${document.referrer || "-"}`}
    />
  );
}
