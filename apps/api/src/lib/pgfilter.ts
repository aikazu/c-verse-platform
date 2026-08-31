// PostgREST filter-input sanitizers (lane B, audit 2026-08-31).
// The service-role read layer interpolates user input into or()/ilike() filter
// templates where RLS is not a backstop — these helpers guarantee the value can
// never alter query syntax or widen the match beyond a literal term.

/** Escape LIKE/ILIKE wildcards (`%`, `_`) and the `\` escape char so a term matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Strip characters that alter PostgREST filter syntax (`,`, `(`, `)`, backtick) and cap length. */
export function sanitizeFilterToken(value: string, maxLength = 100): string {
  return value.replace(/[,()`]/g, "").slice(0, maxLength);
}

/** True when the value is a plain identifier (`A-Za-z0-9_-`, 1..64) — safe to interpolate into `eq` templates. */
export function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
