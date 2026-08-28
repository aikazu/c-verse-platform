import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  generateLink: vi.fn(),
}));

vi.mock("../../lib/supabase.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/supabase.js")>();
  return {
    ...actual,
    getSupabase: () => ({
      auth: { admin: { generateLink: control.generateLink } },
    }),
  };
});

const { app } = await import("../../index.js");

function postDemoLogin(email: unknown) {
  return app.request("/api/auth/demo-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function setDemoFlag(value: string | undefined) {
  const g = globalThis as unknown as Record<string, string | undefined>;
  if (value === undefined) delete g.ENABLE_DEMO_LOGIN;
  else g.ENABLE_DEMO_LOGIN = value;
}

// Demo masa terbatas (lokal): one-click login akun seed via admin.generateLink —
// tetap passwordless, tanpa kirim email. Gerbang ganda: flag + whitelist email seed.
describe("POST /api/auth/demo-login (dev-only one-click login akun seed)", () => {
  beforeEach(() => {
    control.generateLink.mockReset();
  });
  afterEach(() => setDemoFlag(undefined));

  it("404 + tidak menyentuh GoTrue ketika ENABLE_DEMO_LOGIN tidak aktif", async () => {
    setDemoFlag(undefined);
    const res = await postDemoLogin("demo@cverse.id");
    expect(res.status).toBe(404);
    expect(control.generateLink).not.toHaveBeenCalled();
  });

  it("403 untuk email di luar whitelist seed", async () => {
    setDemoFlag("1");
    const res = await postDemoLogin("attacker@evil.com");
    expect(res.status).toBe(403);
    expect(control.generateLink).not.toHaveBeenCalled();
  });

  it("400 ketika email tidak valid", async () => {
    setDemoFlag("1");
    const res = await postDemoLogin("bukan-email");
    expect(res.status).toBe(400);
  });

  it("200 + tokenHash untuk akun seed (generateLink magiclink, email dinormalkan)", async () => {
    setDemoFlag("1");
    control.generateLink.mockResolvedValue({
      data: { properties: { action_link: "http://x/verify?token=ht_demo", email_otp: "123456", hashed_token: "ht_demo" } },
      error: null,
    });
    const res = await postDemoLogin("Demo@CVerse.id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; tokenHash: string };
    expect(body).toEqual({ email: "demo@cverse.id", tokenHash: "ht_demo" });
    expect(control.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "demo@cverse.id" });
  });

  it("500 tersanitasi ketika GoTrue gagal — raw error tidak bocor ke response", async () => {
    setDemoFlag("1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    control.generateLink.mockResolvedValue({ data: null, error: { message: "detective: internal GoTrue detail" } });
    const res = await postDemoLogin("karina@creator.id");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Gagal membuat sesi demo");
    expect(JSON.stringify(body)).not.toContain("detective");
    errSpy.mockRestore();
  });
});
