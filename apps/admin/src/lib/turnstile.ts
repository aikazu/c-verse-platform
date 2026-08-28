// Cloudflare Turnstile widget loader (docs/10 §3.2) — render dulu, token disertakan tiap request OTP.
// Salin dari apps/web/src/lib/turnstile.ts — jaga kedua salinan sinkron.

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

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const prev = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (prev) {
      const handler = () => resolve();
      prev.addEventListener("load", handler);
      return;
    }
    window.onTurnstileLoad = () => resolve();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "1";
    script.onerror = () => resolve(); // jangan blok login jika CDN gagal
    document.head.appendChild(script);
  });
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
    reset: () => window.turnstile?.reset(id),
    destroy: () => window.turnstile?.remove(id),
  };
}
