import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "https://example.supabase.co";
});

describe("rate limiter environment isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(["development", "local-database", "tsx"])("Worker bindings override %s process heuristics", async (hostMode) => {
    vi.resetModules();
    vi.stubEnv("ENV", hostMode === "development" ? "development" : "test");
    vi.stubEnv("SUPABASE_URL", hostMode === "local-database" ? "http://localhost:54321" : "https://example.supabase.co");
    if (hostMode === "tsx") vi.spyOn(process, "argv", "get").mockReturnValue(["node", "/tools/tsx/cli.mjs"]);
    const { app } = await import("../index.js");
    const limit = vi.fn(() => Promise.resolve({ success: false }));
    const response = await app.request("/health", {}, { ENV: "production", GLOBAL_RATE_LIMITER: { limit } });
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();
  });

  it("fails closed for a missing production binding while leaving local requests usable", async () => {
    const { app } = await import("../index.js");
    expect((await app.request("/health", {}, { ENV: "production" })).status).toBe(503);
    expect((await app.request("/health", {}, { ENV: "development" })).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200);
  });
});
