import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  existingUsername: null as string | null,
  updateCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@cverse.id",
        displayName: "Old Name",
        role: "user",
        username: "u1",
        usernameIsAuto: false,
        flagReason: null,
      },
      token: "t",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/users.js", () => ({
  getUserByUsername: (u: string) =>
    control.existingUsername === u ? Promise.resolve({ id: "someone-else", username: u, email: "x@y.id" } as never) : Promise.resolve(null),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => {
          control.updateCalls.push(patch);
          return q;
        },
        eq: () => q,
      };
      // biome-ignore lint/suspicious/noThenProperty: PostgREST builder must be thenable
      q.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
      return q;
    },
  }),
  _resetSupabaseCache: () => undefined,
}));

const { app } = await import("../../../index.js");

function patchProfile(body: Record<string, unknown>) {
  return app.request("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/profile displayName validation (L1 audit 2026-08-24)", () => {
  beforeEach(() => {
    control.existingUsername = null;
    control.updateCalls = [];
  });

  it("displayName biasa tanpa karakter terlarang -> 200", async () => {
    const res = await patchProfile({ displayName: "Budi Santoso" });
    expect(res.status).toBe(200);
    expect(control.updateCalls[0]?.display_name).toBe("Budi Santoso");
  });

  it("displayName dengan < (HTML) -> 400 (Zod regex)", async () => {
    const res = await patchProfile({ displayName: "Evil<script>" });
    expect(res.status).toBe(400);
  });

  it("displayName dengan & (HTML entity) -> 400", async () => {
    const res = await patchProfile({ displayName: "A & B" });
    expect(res.status).toBe(400);
  });

  it("displayName dengan karakter kontrol -> 400", async () => {
    const res = await patchProfile({ displayName: "Bad\u0000Name" });
    expect(res.status).toBe(400);
  });

  it("displayName spasi-only atau kosong -> 400 (trim + min length)", async () => {
    // "  " trims to "" → Zod min(2) catches it before regex.
    const res = await patchProfile({ displayName: "  " });
    expect(res.status).toBe(400);
  });

  it("username dengan regex valid -> 200", async () => {
    const res = await patchProfile({ username: "new_handle" });
    expect(res.status).toBe(200);
  });
});
