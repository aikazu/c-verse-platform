import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  cardExists: true as boolean,
  isSeed: true as boolean,
  updateError: null as { message: string } | null,
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../lib/auth.js", () => ({
  requireAdmin: () =>
    Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        xp: 0,
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
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

vi.mock("../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "cards") {
      return {
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () =>
              control.cardExists
                ? Promise.resolve({
                    data: { id: "card-seed-1", location: "with_owner", verify_status: "unknown", drop_id: "drop-seed-1" },
                    error: null,
                  })
                : Promise.resolve({ data: null, error: null }),
          };
          return builder;
        },
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () =>
                control.updateError
                  ? Promise.resolve({ data: null, error: control.updateError })
                  : Promise.resolve({
                      data: { id: "card-seed-1", location: "platform_vault", verify_status: "unknown", drop_id: "drop-seed-1" },
                      error: null,
                    }),
            }),
          }),
        }),
      };
    }
    if (table === "drops") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "drop-seed-1", is_seed: control.isSeed },
                error: null,
              }),
          }),
        }),
      };
    }
    return { select: () => ({}) };
  });
  const db = { from: fakeFrom };
  return { getSupabase: () => db };
});

const { app } = await import("../../index.js");

function vaultIn(body: Record<string, unknown> | undefined) {
  return app.request("/api/admin/cards/card-seed-1/vault-in", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("PATCH /api/admin/cards/:id/vault-in", () => {
  beforeEach(() => {
    control.cardExists = true;
    control.isSeed = true;
    control.updateError = null;
    control.auditCalls = [];
  });

  it("set location=platform_vault, verify_status tetap unknown (tidak dipalsukan), audit tercatat", async () => {
    const res = await vaultIn({ physicalCheckNote: "kondisi fisik OK, holo utuh" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { location: string; verify_status: string } };
    expect(body.card.location).toBe("platform_vault");
    expect(body.card.verify_status).toBe("unknown");
    expect(control.auditCalls.length).toBe(1);
    const payload = control.auditCalls[0].args as unknown[];
    expect(payload[1]).toBe("update");
    expect(payload[2]).toBe("cards");
    expect(payload[3]).toBe("card-seed-1");
    const summary = payload[4] as { action: string; verify_status_untouched: string };
    expect(summary.action).toBe("vault_in");
    expect(summary.verify_status_untouched).toBe("unknown");
  });

  it("kartu tidak ditemukan -> 404", async () => {
    control.cardExists = false;
    const res = await vaultIn({});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Kartu tidak ditemukan");
    expect(control.auditCalls.length).toBe(0);
  });

  it("update error -> 400", async () => {
    control.updateError = { message: "duplicate key" };
    const res = await vaultIn({});
    expect(res.status).toBe(400);
  });

  it("body kosong (physicalCheckNote optional) -> 200", async () => {
    const res = await vaultIn({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { location: string } };
    expect(body.card.location).toBe("platform_vault");
  });

  it("non-seed card -> 400 NOT_SEED_CARD, no update, no audit", async () => {
    control.isSeed = false;
    const res = await vaultIn({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("NOT_SEED_CARD");
    expect(body.error).toMatch(/seed/i);
    expect(control.auditCalls.length).toBe(0);
  });
});
