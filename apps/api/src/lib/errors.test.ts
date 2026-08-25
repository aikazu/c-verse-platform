import { describe, expect, it } from "vitest";
import { sanitizeDbError } from "./errors";

// M6 (audit 2026-08-24): raw Supabase / Postgres error messages expose schema
// details (constraint names, column names) — clients should never see them.

describe("sanitizeDbError", () => {
  it("maps duplicate-key violations to a safe message", () => {
    expect(
      sanitizeDbError({
        message: 'duplicate key value violates unique constraint "users_canonical_email_uidx"',
      }),
    ).toBe("Resource already exists");
  });

  it("maps RLS policy violations to Forbidden", () => {
    expect(sanitizeDbError({ message: "new row violates row-level security policy for table users" })).toBe("Forbidden");
  });

  it("maps FK violations to Referenced resource not found", () => {
    expect(sanitizeDbError({ message: "insert or update on table cards violates foreign key constraint fk_drop" })).toBe(
      "Referenced resource not found",
    );
  });

  it("maps bad UUID input to Invalid identifier", () => {
    expect(sanitizeDbError({ message: 'invalid input syntax for type uuid: "abc"' })).toBe("Invalid identifier");
  });

  it("maps check-constraint failures to Constraint violation", () => {
    expect(sanitizeDbError({ message: 'new row for relation "wallets" violates check constraint "wallets_balance_nonneg"' })).toBe(
      "Constraint violation",
    );
  });

  it("null value not-null -> Required field missing", () => {
    expect(sanitizeDbError({ message: 'null value in column "email" violates not-null constraint' })).toBe("Required field missing");
  });

  it("permission denied -> Forbidden", () => {
    expect(sanitizeDbError({ message: "permission denied for table users" })).toBe("Forbidden");
  });

  it("unknown error -> fallback 'Operasi gagal' (no schema disclosure)", () => {
    expect(sanitizeDbError({ message: "Some really weird internal error mentioning column_x" })).toBe("Operasi gagal");
  });

  it("missing/null error -> fallback", () => {
    expect(sanitizeDbError(null)).toBe("Operasi gagal");
    expect(sanitizeDbError(undefined)).toBe("Operasi gagal");
    expect(sanitizeDbError({ message: "" })).toBe("Operasi gagal");
  });
});
