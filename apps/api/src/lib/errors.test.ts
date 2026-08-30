import { describe, expect, it } from "vitest";
import { clientErrorMessage, sanitizeDbError } from "./errors";

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

  // Pentest P2 (2026-08-30): curated RPC business errors (P0001) are part of the
  // client contract — a bare UPPER_SNAKE token or "TOKEN: detail" must survive.
  it("passes curated RPC business codes through verbatim", () => {
    expect(sanitizeDbError({ message: "INSUFFICIENT" })).toBe("INSUFFICIENT");
    expect(sanitizeDbError({ message: "COOLDOWN_PERIOD_24H" })).toBe("COOLDOWN_PERIOD_24H");
    expect(sanitizeDbError({ message: "TOPUP_CAP_EXCEEDED" })).toBe("TOPUP_CAP_EXCEEDED");
    expect(sanitizeDbError({ message: "NOT_FOR_SALE" })).toBe("NOT_FOR_SALE");
    expect(sanitizeDbError({ message: "INVALID_ARG: status weird tidak dikenal" })).toBe("INVALID_ARG: status weird tidak dikenal");
  });
});

describe("clientErrorMessage (pentest P2 — raw DB message leak via global onError)", () => {
  it("raw uuid syntax error maps to 'Invalid identifier', never the raw message", () => {
    const out = clientErrorMessage(new Error('invalid input syntax for type uuid: "system"'));
    expect(out).toBe("Invalid identifier");
    expect(out).not.toContain("uuid");
    expect(out).not.toContain("system");
  });

  it("curated business message survives to the client verbatim", () => {
    expect(clientErrorMessage(new Error("COOLDOWN_PERIOD_24H"))).toBe("COOLDOWN_PERIOD_24H");
    expect(clientErrorMessage(new Error("INVALID_STATE: payout status disbursed tidak bisa di-refund"))).toBe(
      "INVALID_STATE: payout status disbursed tidak bisa di-refund",
    );
  });

  it("HTML-bearing message -> 'External service blocked the request' (M-03 preserved)", () => {
    expect(clientErrorMessage(new Error("<!DOCTYPE html><html>cloudflare block page</html>"))).toBe("External service blocked the request");
    expect(clientErrorMessage(new Error("upstream said <script>alert(1)</script>"))).toBe("External service blocked the request");
  });

  it("message longer than 300 chars -> 'Internal server error' (I-02 preserved)", () => {
    const out = clientErrorMessage(new Error("x".repeat(301)));
    expect(out).toBe("Internal server error");
  });

  it("unknown technical message -> fallback 'Operasi gagal' (no verbatim passthrough)", () => {
    const out = clientErrorMessage(new Error('Could not connect: relation "secret_table" does not exist'));
    expect(out).toBe("Operasi gagal");
    expect(out).not.toContain("secret_table");
  });

  it("missing/empty message -> fallback", () => {
    expect(clientErrorMessage(new Error(""))).toBe("Operasi gagal");
    expect(clientErrorMessage(null)).toBe("Operasi gagal");
  });
});
