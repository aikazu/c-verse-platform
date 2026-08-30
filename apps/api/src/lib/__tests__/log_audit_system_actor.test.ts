import { beforeEach, describe, expect, it, vi } from "vitest";

// Pentest F3 (2026-08-30): admin_audit_log.admin_user_id is `uuid not null`
// (supabase/migrations/01_schema.sql), but NFC/payments rejection paths pass
// the literal "system" as the actor → Postgres rejects the insert, logAuditDb
// throws, and the fraud audit trail is never written. The reserved actor
// "system" must map to the canonical treasury/system user UUID.

const control = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  insertError: null as { message: string } | null,
}));

// Seam: reads/kyc.ts → readDb() → getSupabase() — mock at the supabase seam
// (same style as cron.test.ts; the real client never loads, no env required).
vi.mock("../supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        control.insertCalls.push({ table, payload });
        return Promise.resolve({ data: null, error: control.insertError });
      },
    }),
  }),
}));

const { logAuditDb, SYSTEM_ACTOR_ID } = await import("../reads/kyc.js");

describe("logAuditDb — reserved actor 'system' (pentest F3)", () => {
  beforeEach(() => {
    control.insertCalls = [];
    control.insertError = null;
  });

  it("maps actor 'system' to the treasury system-user uuid", async () => {
    await logAuditDb("system", "view_sensitive", "cards", "card-x", { fraud: "nfc_cmac_invalid" }, null, null);

    expect(control.insertCalls).toHaveLength(1);
    const call = control.insertCalls[0];
    expect(call.table).toBe("admin_audit_log");
    // Canonical treasury/system user: 04_rpc.sql record_platform_revenue v_treasury
    expect(SYSTEM_ACTOR_ID).toBe("00000000-0000-4000-8000-0000000000c0");
    expect(call.payload.admin_user_id).toBe(SYSTEM_ACTOR_ID);
    expect(call.payload.admin_user_id).not.toBe("system");
  });

  it("passes a real uuid actor through unchanged", async () => {
    const realAdminId = "11111111-1111-4111-8111-111111111111";
    await logAuditDb(realAdminId, "kyc_approve", "kyc_records", "kyc-1", { status: "approved" }, "127.0.0.1", "sess-1");

    expect(control.insertCalls).toHaveLength(1);
    expect(control.insertCalls[0].payload.admin_user_id).toBe(realAdminId);
  });

  it("still throws when the insert fails (fail-loud audit integrity preserved)", async () => {
    control.insertError = { message: 'invalid input syntax for type uuid: "not-a-uuid"' };
    await expect(logAuditDb("not-a-uuid", "view_sensitive", "cards", "card-x", null, null, null)).rejects.toThrow(
      "invalid input syntax for type uuid",
    );
    expect(control.insertCalls).toHaveLength(1);
  });
});
