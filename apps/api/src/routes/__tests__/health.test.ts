import { describe, expect, it, vi } from "vitest";

// Set SUPABASE_URL via globalThis (bukan process.env) di hoisted position
// karena index.ts cek g.SUPABASE_URL duluan sebelum process.env
vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const { app } = await import("../../index.js");

describe("Health endpoints", () => {
  it("GET / returns API info", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("C.Verse API");
    expect(body.status).toBe("ok");
  });

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("GET /nonexistent returns 404", async () => {
    const res = await app.request("/api/tidak-ada");
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });
});