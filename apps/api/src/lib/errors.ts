// Map Supabase / Postgres error messages to safe client-facing strings (M6 audit
// 2026-08-24). The raw `error.message` exposes schema details (constraint names,
// column names, duplicate values) — useful for ops but a low-grade info disclosure.
// Routes should pass the original error through this helper and log the raw message
// server-side for incident response.

const MAPPINGS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /duplicate key value violates unique constraint/i, message: "Resource already exists" },
  { pattern: /violates row-level security policy/i, message: "Forbidden" },
  { pattern: /violates foreign key constraint/i, message: "Referenced resource not found" },
  { pattern: /invalid input syntax for type uuid/i, message: "Invalid identifier" },
  { pattern: /violates check constraint/i, message: "Constraint violation" },
  { pattern: /null value in column .* violates not-null constraint/i, message: "Required field missing" },
  { pattern: /permission denied/i, message: "Forbidden" },
];

// Exported for lib/db.ts callRpc — unmapped RPC codes fall back to the same
// generic copy so raw Postgres text never reaches clients through any seam.
export const FALLBACK = "Operasi gagal";

// Pentest P2 (2026-08-30): curated RPC business errors are part of the client
// contract. SECURITY DEFINER RPCs surface them as P0001 messages shaped as a
// bare UPPER_SNAKE token (INSUFFICIENT, TOPUP_CAP_EXCEEDED) or "TOKEN: detail"
// (INVALID_ARG: status x tidak dikenal) — see RAISE EXCEPTION in 04_rpc.sql.
// They carry no schema information, so they pass through verbatim; anything
// else unknown falls back to FALLBACK so raw Postgres text never reaches clients.
const BUSINESS_CODE = /^[A-Z][A-Z0-9_]+(?:: .*)?$/;

export interface SanitizableError {
  message?: string | null;
}

export function sanitizeDbError(err: SanitizableError | null | undefined): string {
  if (!err || typeof err.message !== "string") return FALLBACK;
  const trimmed = err.message.trim();
  if (BUSINESS_CODE.test(trimmed)) return trimmed;
  for (const { pattern, message } of MAPPINGS) {
    if (pattern.test(trimmed)) return message;
  }
  return FALLBACK;
}

// M-03: HTML markers from upstream block pages (Cloudflare) — never echoed.
const HTML_MARKERS = ["<!DOCTYPE", "<html", "<script"] as const;
// I-02: oversized messages (Zod payloads, stack traces) collapse to a generic.
const MAX_MESSAGE_LENGTH = 300;

/**
 * Single seam for the global onError client-facing message (pentest P2):
 * block HTML leaks, cap length, then run the raw text through the
 * sanitizeDbError allowlist. Raw server-side logging happens at the caller.
 */
export function clientErrorMessage(err: SanitizableError | null | undefined): string {
  const raw = typeof err?.message === "string" && err.message !== "" ? err.message : FALLBACK;
  if (HTML_MARKERS.some((marker) => raw.includes(marker))) return "External service blocked the request";
  if (raw.length > MAX_MESSAGE_LENGTH) return "Internal server error";
  return sanitizeDbError({ message: raw });
}
