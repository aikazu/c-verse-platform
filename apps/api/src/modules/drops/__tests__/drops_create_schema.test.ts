import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  authenticatedAs: "auth-user-1" as string,
  insertCall: null as Record<string, unknown> | null,
  auditCalls: [] as Array<Record<string, unknown>>,
  postInsertCardCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../lib/auth.js", () => ({
  // Drop create admin-only (founder 2026-08-29) — test ini fokus ke skema
  // creatorId M9, jadi mock sebagai admin yang berhak membuat drop.
  requireUser: () =>
    Promise.resolve({
      user: {
        id: control.authenticatedAs,
        email: "auth-user-1@cverse.id",
        displayName: "Auth User",
        role: "admin",
        username: "authuser",
        usernameIsAuto: false,
      },
      token: "t",
    }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === "drops") {
          control.insertCall = row;
          return Promise.resolve({ error: null });
        }
        if (table === "cards") {
          control.postInsertCardCalls.push(row);
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
    }),
  }),
  _resetSupabaseCache: () => undefined,
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  getDropById: () => Promise.resolve({ id: "drop-x", creatorId: control.authenticatedAs } as never),
  listDrops: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
}));

const { app } = await import("../../../index.js");

function postDrop(body: Record<string, unknown>) {
  return app.request("/api/drops", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/drops schema (M9 audit 2026-08-24)", () => {
  beforeEach(() => {
    control.authenticatedAs = "auth-user-1";
    control.insertCall = null;
    control.auditCalls = [];
    control.postInsertCardCalls = [];
  });

  it("body tanpa creatorId: route assigns creator_id from authenticated user", async () => {
    const res = await postDrop({
      title: "Drop Test",
      series: "Series Test",
      narrative: "A meaningful narrative for the test drop",
      totalUnits: 5,
      priceCcoin: 30,
    });
    expect(res.status).toBe(201);
    expect(control.insertCall?.creator_id).toBe("auth-user-1");
    expect(control.insertCall?.creator_name).toBe("Auth User");
  });

  it("body dengan foreign creatorId: diabaikan — creator_id tetap dari auth user", async () => {
    const res = await postDrop({
      title: "Drop Test",
      series: "Series Test",
      narrative: "A meaningful narrative for the test drop",
      totalUnits: 5,
      priceCcoin: 30,
      // M9: field ini dihapus dari schema — harus diabaikan, BUKAN dipakai.
      creatorId: "some-other-user",
    });
    expect(res.status).toBe(201);
    expect(control.insertCall?.creator_id).toBe("auth-user-1");
    expect(control.insertCall?.creator_id).not.toBe("some-other-user");
  });
});
