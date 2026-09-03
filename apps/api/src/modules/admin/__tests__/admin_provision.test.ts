import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  createUserError: null as { message: string } | null,
  creatorInsertError: null as { message: string } | null,
  userUpdateError: null as { message: string } | null,
  existingEmail: null as string | null,
  createdUserId: "new-uid",
  deletedUsers: [] as string[],
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: () =>
    Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "t",
    }),
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "t",
      aal: "aal2",
    }),
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));

vi.mock("../../../lib/email.js", () => ({
  sendCreatorAccessEmail: () => Promise.resolve({ sent: false, reason: "disabled" }),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: () => Promise.resolve(),
}));

vi.mock("../../../lib/supabase.js", () => {
  const empty = () => Promise.resolve({ data: null, error: null });
  const fakeFrom = vi.fn((table: string) => {
    if (table === "users") {
      return {
        select: () => {
          const builder = {
            eq: () => builder,
            or: () => builder,
            maybeSingle: () =>
              control.existingEmail
                ? Promise.resolve({ data: { id: "existing-uid" }, error: null })
                : Promise.resolve({ data: null, error: null }),
          };
          return builder;
        },
        update: () => ({
          eq: () => (control.userUpdateError ? Promise.resolve({ data: null, error: control.userUpdateError }) : empty()),
        }),
      };
    }
    if (table === "creators") {
      return {
        insert: () =>
          control.creatorInsertError
            ? Promise.resolve({ data: null, error: control.creatorInsertError })
            : Promise.resolve({ data: null, error: null }),
      };
    }
    return { select: () => ({}) };
  });
  const db = {
    auth: {
      admin: {
        createUser: () =>
          control.createUserError
            ? Promise.resolve({ data: null, error: control.createUserError })
            : Promise.resolve({ data: { user: { id: control.createdUserId } }, error: null }),
        deleteUser: (id: string) => {
          control.deletedUsers.push(id);
          return empty();
        },
      },
    },
    from: fakeFrom,
  };
  return { getSupabase: () => db };
});

const { app } = await import("../../../index.js");

function provision(body: Record<string, unknown>) {
  return app.request("/api/admin/users/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  email: "creator@example.com",
  displayName: "Budi Kreator",
  handle: "budi.kreator",
  totalFollowersCombined: 120000,
  notes: "deal memo 2026-08-20",
};

describe("POST /api/admin/users/provision", () => {
  beforeEach(() => {
    control.createUserError = null;
    control.creatorInsertError = null;
    control.userUpdateError = null;
    control.existingEmail = null;
    control.deletedUsers = [];
  });

  it("payload valid -> 201, role creator, emailSent=false (EMAIL_ENABLED OFF)", async () => {
    const res = await provision(VALID);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string; role: string };
      creator: { handle: string };
      emailSent: boolean;
    };
    expect(body.user.id).toBe("new-uid");
    expect(body.user.role).toBe("creator");
    expect(body.user.email).toBe("creator@example.com");
    expect(body.creator.handle).toBe("budi.kreator");
    expect(body.emailSent).toBe(false);
  });

  it("payload invalid (email kosong) -> 400 dari zValidator", async () => {
    const res = await provision({ ...VALID, email: "" });
    expect(res.status).toBe(400);
  });

  it("createUser error 'already registered' -> 409 Email sudah terdaftar", async () => {
    control.createUserError = { message: "User already registered" };
    const res = await provision(VALID);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Email sudah terdaftar");
  });

  it("createUser error lain -> 400 dengan pesan ter-sanitasi (M6 audit 2026-08-24)", async () => {
    control.createUserError = { message: "Email not allowed" };
    const res = await provision(VALID);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // Raw Supabase / GoTrue messages are no longer leaked to clients — the helper
    // sanitizes known shapes to safe copy and falls back to a generic message.
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("Email not allowed");
  });

  it("handle bentrok -> 409 'Handle sudah dipakai' + rollback auth user (tidak ada akun yatim)", async () => {
    control.creatorInsertError = { message: 'duplicate key value violates unique constraint "creators_handle_key"' };
    const res = await provision(VALID);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Handle sudah dipakai");
    expect(control.deletedUsers).toContain("new-uid");
  });

  // Lane E (audit 2026-08-31): step-2 users update / step-3 creators insert
  // non-duplicate used to echo raw err.message — must go through sanitizeDbError.
  it("users update error -> 400 sanitized (raw schema detail tidak bocor)", async () => {
    control.userUpdateError = { message: 'column "role_x" of relation "users" does not exist' };
    const res = await provision(VALID);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("role_x");
  });

  it("creator insert error non-duplicate -> 400 sanitized (raw text tidak bocor)", async () => {
    control.creatorInsertError = { message: 'null value in column "user_id" of relation "creators" violates not-null constraint' };
    const res = await provision(VALID);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Required field missing");
    expect(body.error).not.toContain("user_id");
  });
});
