import type { z } from "zod";

/**
 * I-02: ZodError sanitizer — tidak expose schema details ke client.
 * Gunakan di route handler untuk wrap Zod validation error.
 */
const GENERIC_MESSAGES: Record<string, string> = {
  invalid_type: "Invalid input type",
  too_small: "Input value too small",
  too_big: "Input value too big",
  invalid_string: "Invalid input format",
  unrecognized_keys: "Unexpected field in request",
  required: "Required field missing",
};

export function sanitizeZodError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) return "Validation failed";
  return GENERIC_MESSAGES[firstIssue.code] ?? "Validation failed";
}

/**
 * Safe validator wrapper — return error message instead of ZodError detail.
 * Contoh penggunaan:
 *   const parsed = safeParse(mySchema, input);
 *   if (!parsed.success) return c.json({ error: parsed.error }, 400);
 */
export function safeParse<T>(schema: z.ZodSchema<T>, input: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: sanitizeZodError(result.error) };
}
