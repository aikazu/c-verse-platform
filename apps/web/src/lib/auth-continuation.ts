export const OAUTH_CONTINUATION_KEY = "cverse_oauth_continuation_v1";
const OAUTH_CONTINUATION_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthContinuation {
  path: string;
  createdAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/** Accept only a same-origin application path, never a URL-like redirect. */
export function safeAppPath(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    // Backslashes are normalized as slashes by browser URL parsers and can turn
    // an apparently relative path into a protocol-relative external redirect.
    if (value.includes("\\") || decodeURIComponent(value).includes("\\")) return null;
    const target = new URL(value, origin);
    if (target.origin !== new URL(origin).origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export function saveOAuthContinuation(path: unknown, storage: StorageLike, origin: string, now = Date.now()): boolean {
  const safePath = safeAppPath(path, origin);
  if (!safePath) return false;
  try {
    storage.setItem(OAUTH_CONTINUATION_KEY, JSON.stringify({ path: safePath, createdAt: now } satisfies OAuthContinuation));
    return true;
  } catch {
    return false;
  }
}

/** Consume once so an OAuth callback cannot replay a stale navigation. */
export function consumeOAuthContinuation(storage: StorageLike, origin: string, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(OAUTH_CONTINUATION_KEY);
    storage.removeItem(OAUTH_CONTINUATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OAuthContinuation>;
    if (typeof value.createdAt !== "number" || now - value.createdAt < 0 || now - value.createdAt > OAUTH_CONTINUATION_MAX_AGE_MS)
      return null;
    return safeAppPath(value.path, origin);
  } catch {
    return null;
  }
}

export function clearOAuthContinuation(storage: Pick<StorageLike, "removeItem">): void {
  try {
    storage.removeItem(OAUTH_CONTINUATION_KEY);
  } catch {
    // Browser storage can be disabled; OAuth itself should still be usable.
  }
}
