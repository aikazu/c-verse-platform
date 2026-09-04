import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetSupabaseCache, getSupabase } from "./supabase";

// Server-side guard (M1): admin route handlers MUST use the service-role client to
// bypass RLS for privileged mutations. Silent fallback to the anon key turned a
// missing/wrong SERVICE_ROLE env into a confusing partial failure; the audit and
// release-seed-sale paths in particular depend on the bypass.

describe("getSupabase — service-role fail-fast (M1)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetSupabaseCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetSupabaseCache();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing even with anon key present", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test-key";
    Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    expect(() => getSupabase()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when neither service-role nor anon key is set", () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    Reflect.deleteProperty(process.env, "SUPABASE_ANON_KEY");
    Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
    expect(() => getSupabase()).toThrow();
  });

  it("returns a client when env param supplies the service-role key", () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
    const client = getSupabase({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" });
    expect(client).toBeDefined();
  });

  it("accepts globalThis-injected env at first call (Workers path)", () => {
    Reflect.deleteProperty(process.env, "SUPABASE_URL");
    Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
    (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "https://worker.supabase.co";
    (globalThis as unknown as Record<string, string | undefined>).SUPABASE_SERVICE_ROLE_KEY = "worker-svc";
    try {
      const client = getSupabase();
      expect(client).toBeDefined();
    } finally {
      delete (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL;
      delete (globalThis as unknown as Record<string, string | undefined>).SUPABASE_SERVICE_ROLE_KEY;
    }
  });
});
