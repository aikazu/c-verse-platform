import type React from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: string; msg: string; kind: ToastKind };

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  info: "i",
};

interface ToastApi {
  push: (msg: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastApi>({
  push: () => {},
  dismiss: () => {},
});

const TOAST_TTL_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Map id -> timer + paused flag — pause-on-hover/focus hapus timer tapi
  // toast tetap ada; keluar dari hover/focus restart timer TOAST_TTL_MS.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismissedRef = useRef<Set<string>>(new Set());
  const pauseRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    dismissedRef.current.add(id);
    pauseRef.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const scheduleExpire = useCallback(
    (id: string, delay: number) => {
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => dismiss(id), delay);
      timersRef.current.set(id, t);
    },
    [dismiss],
  );

  const push = useCallback(
    (msg: string, kind: ToastKind = "info") => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (dismissedRef.current.has(id)) return;
      setToasts((t) => [...t, { id, msg, kind }]);
      scheduleExpire(id, TOAST_TTL_MS);
    },
    [scheduleExpire],
  );

  function onEnter(id: string) {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    pauseRef.current.set(id, Date.now());
  }
  function onLeave(id: string) {
    const since = pauseRef.current.get(id);
    if (!since) return;
    pauseRef.current.delete(id);
    const elapsed = Date.now() - since;
    const remaining = Math.max(0, TOAST_TTL_MS - (elapsed % TOAST_TTL_MS));
    // remaining = sisa TTL efektif. Pakai modulo saja sebagai heuristic agar
    // toast tidak hilang terlalu cepat setelah hover singkat.
    scheduleExpire(id, Math.max(500, remaining));
  }

  // Bersihkan set internal saat unmount.
  useEffect(() => {
    const timers = timersRef.current;
    const pause = pauseRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pause.clear();
    };
  }, []);

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div className="toast-area" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            role={t.kind === "error" ? "alert" : "status"}
            onMouseEnter={() => onEnter(t.id)}
            onMouseLeave={() => onLeave(t.id)}
            onFocus={() => onEnter(t.id)}
            onBlur={() => onLeave(t.id)}
          >
            <span aria-hidden="true" className="toast-icon">
              {ICONS[t.kind]}
            </span>
            <span className="toast-msg">{t.msg}</span>
            <button type="button" className="toast-dismiss" aria-label="Tutup notifikasi" onClick={() => dismiss(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
