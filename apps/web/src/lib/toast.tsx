import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: string; msg: string; kind: "success" | "error" | "info" };
const Ctx = createContext<{ toasts: Toast[]; push: (msg: string, kind?: Toast["kind"]) => void; dismiss: (id: string) => void }>({
  toasts: [],
  push: () => {},
  dismiss: () => {},
});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Math.random().toString(36).slice(2, 8);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  return (
    <Ctx.Provider value={{ toasts, push, dismiss }}>
      {children}
      <div className="toast-area">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
