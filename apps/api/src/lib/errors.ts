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

const FALLBACK = "Operasi gagal";

export interface SanitizableError {
  message?: string | null;
}

export function sanitizeDbError(err: SanitizableError | null | undefined): string {
  if (!err || typeof err.message !== "string") return FALLBACK;
  for (const { pattern, message } of MAPPINGS) {
    if (pattern.test(err.message)) return message;
  }
  return FALLBACK;
}
