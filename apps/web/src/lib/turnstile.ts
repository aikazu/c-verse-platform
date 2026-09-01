// Cloudflare Turnstile widget loader (docs/10 §3.2) — render dulu, token disertakan tiap request OTP.

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";

export const isTurnstileEnabled = SITE_KEY.length > 0;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; "expired-callback"?: () => void },
      ) => string;
      remove: (id: string) => void;
      getResponse: (id?: string) => string | undefined;
      reset: (id?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

// Satu attempt load = satu promise yang di-memoize; semua pemanggil berbagi nasib tag yang sama.
let scriptPromise: Promise<void> | undefined;

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    window.onTurnstileLoad = () => resolve();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Buang tag gagal + lepas memo agar mount berikutnya bisa mencoba tag baru;
      // tetap resolve — jangan blok login jika CDN gagal (pemanggil dapat no-op handle).
      script.remove();
      scriptPromise = undefined;
      resolve();
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  token: () => string | undefined;
  reset: () => void;
  destroy: () => void;
}

/** Mount a Turnstile widget. Falls back to a no-op when site key is absent (dev). */
export async function mountTurnstile(
  container: HTMLElement,
  onSolved?: (token: string) => void,
  onExpired?: () => void,
): Promise<TurnstileHandle> {
  if (!isTurnstileEnabled || !SITE_KEY) {
    return { token: () => undefined, reset: () => {}, destroy: () => {} };
  }
  await loadScript();
  if (!window.turnstile) {
    return { token: () => undefined, reset: () => {}, destroy: () => {} };
  }
  let solved: string | undefined;
  const id = window.turnstile.render(container, {
    sitekey: SITE_KEY,
    callback: (token: string) => {
      solved = token;
      onSolved?.(token);
    },
    "expired-callback": () => {
      solved = undefined;
      onExpired?.();
    },
  });
  return {
    token: () => solved ?? window.turnstile?.getResponse(id),
    reset: () => {
      // Single-use: kosongkan token lama seketika (jangan tunggu widget solve ulang),
      // supaya token() tak pernah mengembalikan token yang sudah terpakai.
      solved = undefined;
      window.turnstile?.reset(id);
    },
    destroy: () => window.turnstile?.remove(id),
  };
}
