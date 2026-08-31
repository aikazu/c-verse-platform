import { describe, expect, it } from "vitest";
import { escapeLikePattern, isSafeId, sanitizeFilterToken } from "../pgfilter.js";

// Unit tests for PostgREST filter-input sanitizers (lib/pgfilter.ts).
// These guard the service-role read layer: user input interpolated into
// or()/ilike() templates must never alter filter syntax (lane B, audit 2026-08-31).

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards % and _ so they match literally", () => {
    expect(escapeLikePattern("50%_off")).toBe("50\\%\\_off");
  });

  it("escapes the backslash escape character itself", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeLikePattern("aespa-live 01")).toBe("aespa-live 01");
  });
});

describe("sanitizeFilterToken", () => {
  it("strips commas so a value cannot inject extra or() conditions", () => {
    expect(sanitizeFilterToken("x,status.eq.draft")).toBe("xstatus.eq.draft");
  });

  it("strips parentheses and backticks that alter PostgREST filter syntax", () => {
    expect(sanitizeFilterToken("bad(or(x))")).toBe("badorx");
    expect(sanitizeFilterToken("a`b")).toBe("ab");
  });

  it("caps the token length at maxLength (default 100)", () => {
    expect(sanitizeFilterToken("a".repeat(150)).length).toBe(100);
    expect(sanitizeFilterToken("a".repeat(150), 10)).toBe("a".repeat(10));
  });

  it("leaves a normal search term intact", () => {
    expect(sanitizeFilterToken("aespa live")).toBe("aespa live");
  });
});

describe("isSafeId", () => {
  it("accepts plain identifiers: slugs, short ids and UUIDs", () => {
    expect(isSafeId("card-1")).toBe(true);
    expect(isSafeId("AESL-001")).toBe(true);
    expect(isSafeId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects values carrying PostgREST filter syntax or other unsafe chars", () => {
    expect(isSafeId("bad,or(nfc_short_id.eq.x")).toBe(false);
    expect(isSafeId("a b")).toBe(false);
    expect(isSafeId("a.b")).toBe(false);
    expect(isSafeId("%04AB")).toBe(false);
    expect(isSafeId("")).toBe(false);
  });

  it("rejects values longer than 64 chars", () => {
    expect(isSafeId("a".repeat(65))).toBe(false);
    expect(isSafeId("a".repeat(64))).toBe(true);
  });
});
