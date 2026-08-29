import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  rpcResults: new Map<string, { data: unknown; error: { message: string; code?: string } | null }>(),
  sendEmailCalls: [] as Array<{ to: string; subject: string; text: string; html: string }>,
  sendEmailError: undefined as unknown,
}));

vi.mock("../supabase.js", () => ({
  getSupabase: () => ({
    rpc: (fn: string) => {
      control.rpcCalls.push(fn);
      return Promise.resolve(control.rpcResults.get(fn) ?? { data: 1, error: null });
    },
  }),
}));

vi.mock("../email.js", () => ({
  sendEmail: (input: { to: string; subject: string; text: string; html: string }) => {
    control.sendEmailCalls.push(input);
    if (control.sendEmailError !== undefined) return Promise.reject(control.sendEmailError);
    return Promise.resolve({ sent: true });
  },
}));

const { CRON_EVERY_5_MIN, CRON_PAYOUT_BATCH, runCron } = await import("../cron.js");

function rpcFailure(fn: string, message: string): void {
  control.rpcResults.set(fn, { data: null, error: { message, code: "P0001" } });
}

describe("cron — escrow_auto_release dihapus (founder 2026-08-28)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcResults.clear();
    control.sendEmailCalls = [];
    control.sendEmailError = undefined;
  });

  it("every-5-min: activate_scheduled_drops + draw_pending_drops, TANPA escrow_auto_release", async () => {
    await runCron(CRON_EVERY_5_MIN, {});
    expect(control.rpcCalls).toEqual(["activate_scheduled_drops", "draw_pending_drops"]);
    expect(control.rpcCalls).not.toContain("escrow_auto_release");
  });

  it("payout batch tetap jalan", async () => {
    await runCron(CRON_PAYOUT_BATCH, {});
    expect(control.rpcCalls).toEqual(["payout_batch_run"]);
  });

  it("cron tak dikenal -> tidak ada RPC", async () => {
    await runCron("0 0 31 2 *", {});
    expect(control.rpcCalls).toHaveLength(0);
  });
});

describe("cron — admin alert digest on job failures", () => {
  beforeEach(() => {
    control.rpcCalls = [];
    control.rpcResults.clear();
    control.sendEmailCalls = [];
    control.sendEmailError = undefined;
  });

  it("jobs fail + ADMIN_ALERT_EMAIL set -> exactly ONE aggregated sendEmail with both job names", async () => {
    rpcFailure("activate_scheduled_drops", "relation does not exist");
    rpcFailure("draw_pending_drops", "function draw_pending_drops() does not exist");
    await runCron(CRON_EVERY_5_MIN, { ADMIN_ALERT_EMAIL: "admin@cverse.id" });
    expect(control.sendEmailCalls).toHaveLength(1);
    const alert = control.sendEmailCalls[0];
    expect(alert.to).toBe("admin@cverse.id");
    expect(alert.subject).toContain("cron failures");
    expect(alert.subject).toContain("2 job(s) failed");
    expect(alert.text).toContain("activate_scheduled_drops");
    expect(alert.text).toContain("draw_pending_drops");
    expect(alert.text).toContain("relation does not exist");
    expect(alert.html).toContain("activate_scheduled_drops");
  });

  it("all jobs succeed -> zero sendEmail calls", async () => {
    await runCron(CRON_EVERY_5_MIN, { ADMIN_ALERT_EMAIL: "admin@cverse.id" });
    await runCron(CRON_PAYOUT_BATCH, { ADMIN_ALERT_EMAIL: "admin@cverse.id" });
    expect(control.sendEmailCalls).toHaveLength(0);
  });

  it("ADMIN_ALERT_EMAIL unset + jobs fail -> zero sendEmail calls", async () => {
    rpcFailure("payout_batch_run", "permission denied");
    await runCron(CRON_PAYOUT_BATCH, {});
    expect(control.sendEmailCalls).toHaveLength(0);
  });

  it("sendEmail throws -> runCron still resolves", async () => {
    rpcFailure("payout_batch_run", "permission denied");
    control.sendEmailError = new Error("transport exploded");
    await expect(runCron(CRON_PAYOUT_BATCH, { ADMIN_ALERT_EMAIL: "admin@cverse.id" })).resolves.toBeUndefined();
    expect(control.sendEmailCalls).toHaveLength(1);
  });
});
