import { Component, type ErrorInfo, type ReactNode } from "react";
import ErrorPage from "../pages/ErrorPage";

// Global render-crash boundary: error render (termasuk lazy chunk yang gagal
// dimuat setelah deploy) menampilkan ErrorPage 500 dengan detail teknis,
// BUKAN layar putih. Retry mereset state boundary tanpa reload penuh.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] render crash:", error, errorInfo.componentStack);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { error, componentStack } = this.state;
    const isChunkFailure = /Loading chunk|Failed to fetch dynamically imported module/i.test(error.message);
    return (
      <ErrorPage
        code={500}
        title="Aplikasi tidak dapat dimuat"
        message={
          isChunkFailure
            ? "Sebagian berkas aplikasi gagal dimuat. Periksa koneksi, lalu muat ulang."
            : "Terjadi kesalahan saat menampilkan halaman ini. Muat ulang atau laporkan kendala melalui detail teknis di bawah."
        }
        hint="Kalau tetap gagal setelah muat ulang, coba bersihkan cache atau lapor dengan detail teknis di bawah."
        detail={`${error.name}: ${error.message}\n\n${componentStack ?? "(no component stack)"}`}
        onRetry={() => {
          this.setState({ error: null, componentStack: null });
          window.location.reload();
        }}
      />
    );
  }
}
