// Shared loading / error placeholders for react-query driven pages,
// so a failed fetch is never mistaken for an empty result.

export function LoadingState({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="muted" style={{ padding: 24, textAlign: "center" }}>
      {label}
    </div>
  );
}

export function ErrorState({ onRetry, label = "Gagal memuat data" }: { onRetry?: () => void; label?: string }) {
  return (
    <div className="card card-pad" role="alert" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        Periksa koneksi lalu coba lagi.
      </div>
      {onRetry && (
        <div>
          <button className="btn-ghost" onClick={onRetry} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Coba lagi
          </button>
        </div>
      )}
    </div>
  );
}
