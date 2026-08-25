import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const { app } = await import("../index.js");

// L6 (audit 2026-08-24): every API response must carry the CSP header to
// harden against any future route that might be served as HTML through this
// origin. The CSP is deny-by-default because this is a JSON/XML API.

describe("security headers on every response (L6 audit 2026-08-24)", () => {
  it("GET /health includes X-Frame-Options + CSP + nosniff + Referrer-Policy + Permissions-Policy", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("404 JSON response also carries the headers", async () => {
    const res = await app.request("/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });
});
