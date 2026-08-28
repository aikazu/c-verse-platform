import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // Founder 2026-08-29: drop create/status HANYA admin (docs 02 PG-CRT-01,
  // docs 03 ADM-02) — dashboard kreator read-only analytics.
  role: "creator" as string,
  userId: "creator-1" as string,
  insertDrop: null as Record<string, unknown> | null,
  updateStatus: null as string | null,
}));

vi.mock("../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: control.userId,
        email: `${control.role}@cverse.id`,
        displayName: control.role === "admin" ? "Admin" : "Creator",
        role: control.role,
        username: "u",
        usernameIsAuto: false,
      },
      token: "t",
    }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: () => Promise.resolve(),
}));

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === "drops") {
          control.insertDrop = row;
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => {
              control.updateStatus = (patch.status as string) ?? null;
              return Promise.resolve({ data: { id: "drop-x", status: patch.status }, error: null });
            },
          }),
        }),
      }),
    }),
  }),
  _resetSupabaseCache: () => undefined,
}));

vi.mock("../../lib/reads/drops.js", () => ({
  getDropById: () => Promise.resolve({ id: "drop-x", creatorId: "creator-1", status: "live" } as never),
  listDrops: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
}));

const { app } = await import("../../index.js");

const CREATE_BODY = {
  title: "Drop Test",
  series: "Series Test",
  narrative: "A meaningful narrative for the test drop",
  totalUnits: 5,
  priceCcoin: 30,
};

function postDrop() {
  return app.request("/api/drops", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(CREATE_BODY),
  });
}

function patchStatus(status: string) {
  return app.request("/api/drops/drop-x/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ status }),
  });
}

describe("Drop mutations admin-only (founder 2026-08-29)", () => {
  beforeEach(() => {
    control.role = "creator";
    control.userId = "creator-1";
    control.insertDrop = null;
    control.updateStatus = null;
  });

  it("creator POST /api/drops → 403, tidak ada insert", async () => {
    const res = await postDrop();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Hanya admin yang bisa membuat drop");
    expect(control.insertDrop).toBeNull();
  });

  it("user biasa POST /api/drops → 403", async () => {
    control.role = "user";
    control.userId = "plain-1";
    const res = await postDrop();
    expect(res.status).toBe(403);
    expect(control.insertDrop).toBeNull();
  });

  it("admin POST /api/drops → 201 dengan creator_id = admin", async () => {
    control.role = "admin";
    control.userId = "admin-1";
    const res = await postDrop();
    expect(res.status).toBe(201);
    expect(control.insertDrop?.creator_id).toBe("admin-1");
  });

  it("creator OWNER pun PATCH /:id/status → 403 (cancel/publish bukan wewenang kreator)", async () => {
    const res = await patchStatus("cancelled");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Hanya admin yang bisa mengubah status drop");
    expect(control.updateStatus).toBeNull();
  });

  it("admin PATCH /:id/status → 200", async () => {
    control.role = "admin";
    control.userId = "admin-1";
    const res = await patchStatus("cancelled");
    expect(res.status).toBe(200);
    expect(control.updateStatus).toBe("cancelled");
  });
});
