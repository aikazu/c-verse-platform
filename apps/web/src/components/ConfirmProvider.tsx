import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type LegalConsent, LegalConsentCheckbox } from "./LegalConsentCheckbox";

// Modal konfirmasi in-app (pengganti native window.confirm) — tema Space Arcade.
// API: const confirm = useConfirm(); if (!(await confirm({ title, message }))) return;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Aksi irreversible (accept bid, kirim kartu) — tombol konfirmasi merah. */
  danger?: boolean;
  /** Checklist wajib (founder 2026-09-01): confirm terkunci sampai dicentang. */
  requireCheck?: LegalConsent;
}

type ConfirmRequest = { options: ConfirmOptions; resolve: (value: boolean) => void };

const ConfirmCtx = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmCtx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [isChecked, setIsChecked] = useState(false);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ options, resolve })), []);

  const close = useCallback((value: boolean) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  // Checklist mulai kosong tiap dialog baru — uncheck mengunci confirm kembali.
  useEffect(() => {
    setIsChecked(false);
  }, [request]);

  // Escape = batal (aksesibilitas keyboard), konsisten dengan UsernameSetupModal.
  useEffect(() => {
    if (!request) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, close]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {request && (
        <div className="cfm-overlay" role="dialog" aria-modal="true" aria-labelledby="cfm-title">
          <button type="button" className="cfm-backdrop" aria-label="Tutup" onClick={() => close(false)} />
          <div className="card cfm-card">
            <div className="cfm-eyebrow">KONFIRMASI</div>
            <div className="cfm-title" id="cfm-title">
              {request.options.title}
            </div>
            {request.options.message && <div className="cfm-message">{request.options.message}</div>}
            {request.options.requireCheck ? (
              <LegalConsentCheckbox
                id="cfm-legal-consent"
                consent={request.options.requireCheck}
                checked={isChecked}
                onChange={setIsChecked}
                autoFocus
              />
            ) : null}
            <div className="cfm-actions">
              <button type="button" className="btn-ghost" onClick={() => close(false)}>
                {request.options.cancelLabel ?? "Batal"}
              </button>
              <button
                type="button"
                className={request.options.danger ? "cfm-btn-danger" : "btn-gold"}
                onClick={() => close(true)}
                disabled={!!request.options.requireCheck && !isChecked}
                autoFocus={!request.options.requireCheck || undefined}
              >
                {request.options.confirmLabel ?? "Lanjutkan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
