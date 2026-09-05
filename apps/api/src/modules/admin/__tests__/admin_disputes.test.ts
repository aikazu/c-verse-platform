import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  disputeUpdates: [] as Record<string, unknown>[],
  userUpdates: [] as Record<string, unknown>[],
  fromCalls: [] as string[],
  auditCalls: [] as unknown[][],
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
      token: "admin-token",
    }),
  adminGateError: () => ({ body: { error: "Unauthorized" }, status: 401 }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("../../../lib/supabase.js", () => {
  const db = {
    from(table: string) {
      control.fromCalls.push(table);
      if (table === "disputes") {
        return {
          update(patch: Record<string, unknown>) {
            control.disputeUpdates.push(patch);
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "dispute-1", ...patch }, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === "users") {
        return {
          update(patch: Record<string, unknown>) {
            control.userUpdates.push(patch);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }
      return {};
    },
  };
  return { getSupabase: () => db };
});

const { app } = await import("../../../index.js");

function updateDispute(status: string, decisionNotes = "catatan admin") {
  return app.request("/api/admin/disputes/dispute-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer admin-token" },
    body: JSON.stringify({ status, decisionNotes }),
  });
}

describe("PATCH /api/admin/disputes/:id", () => {
  beforeEach(() => {
    control.disputeUpdates = [];
    control.userUpdates = [];
    control.fromCalls = [];
    control.auditCalls = [];
  });

  it.each(["resolved_refund", "resolved_strike", "resolved_suspend"])(
    "%s ditolak sebelum status, akun, atau audit berubah",
    async (status) => {
      const res = await updateDispute(status);

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/belum.*diimplementasikan/i);
      expect(control.fromCalls).toEqual([]);
      expect(control.disputeUpdates).toEqual([]);
      expect(control.userUpdates).toEqual([]);
      expect(control.auditCalls).toEqual([]);
    },
  );

  it("under_review tetap memperbarui dispute dan mencatat audit", async () => {
    const res = await updateDispute("under_review", "butuh bukti tambahan");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { dispute: { id: string; status: string; decision_notes: string } };
    expect(body.dispute).toEqual({ id: "dispute-1", status: "under_review", decision_notes: "butuh bukti tambahan" });
    expect(control.fromCalls).toEqual(["disputes"]);
    expect(control.disputeUpdates).toEqual([{ status: "under_review", decision_notes: "butuh bukti tambahan" }]);
    expect(control.userUpdates).toEqual([]);
    expect(control.auditCalls).toHaveLength(1);
    expect(control.auditCalls[0].slice(0, 5)).toEqual([
      "admin-1",
      "update",
      "disputes",
      "dispute-1",
      { status: "under_review", decisionNotes: "butuh bukti tambahan" },
    ]);
  });
});
