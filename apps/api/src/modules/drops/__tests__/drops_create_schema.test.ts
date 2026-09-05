import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  authenticatedAs: "auth-user-1" as string,
  creator: { user_id: "11111111-1111-4111-8111-111111111111", status: "active" } as Record<string, unknown> | null,
  creatorUser: { id: "11111111-1111-4111-8111-111111111111", display_name: "Creator Aktif", role: "creator", flag_reason: null } as Record<
    string,
    unknown
  > | null,
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
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: table === "creators" ? control.creator : control.creatorUser, error: null }),
        }),
      }),
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

describe("POST /api/drops creator attribution", () => {
  beforeEach(() => {
    control.authenticatedAs = "auth-user-1";
    control.creator = { user_id: "11111111-1111-4111-8111-111111111111", status: "active" };
    control.creatorUser = { id: "11111111-1111-4111-8111-111111111111", display_name: "Creator Aktif", role: "creator", flag_reason: null };
    control.insertCall = null;
    control.auditCalls = [];
    control.postInsertCardCalls = [];
  });

  const body = {
    title: "Drop Test",
    series: "Series Test",
    narrative: "A meaningful narrative for the test drop",
    totalUnits: 5,
    priceCcoin: 30,
    creatorId: "11111111-1111-4111-8111-111111111111",
  };

  it("assigns the selected active creator instead of the operating admin", async () => {
    const res = await postDrop(body);
    expect(res.status).toBe(201);
    expect(control.insertCall?.creator_id).toBe(body.creatorId);
    expect(control.insertCall?.creator_name).toBe("Creator Aktif");
  });

  it("rejects a missing creatorId before creating a drop", async () => {
    const { creatorId: _creatorId, ...withoutCreator } = body;
    const res = await postDrop(withoutCreator);
    expect(res.status).toBe(400);
    expect(control.insertCall).toBeNull();
  });

  it("rejects an inactive or non-creator target", async () => {
    control.creator = { user_id: body.creatorId, status: "inactive" };
    const inactive = await postDrop(body);
    expect(inactive.status).toBe(422);
    expect(control.insertCall).toBeNull();

    control.creator = { user_id: body.creatorId, status: "active" };
    control.creatorUser = { id: body.creatorId, display_name: "User Biasa", role: "user", flag_reason: null };
    const nonCreator = await postDrop(body);
    expect(nonCreator.status).toBe(422);
    expect(control.insertCall).toBeNull();
  });
});
