import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  rpcCalls: [] as string[],
}));

vi.mock("../supabase.js", () => ({
  getSupabase: () => ({
    rpc: (fn: string) => {
      control.rpcCalls.push(fn);
      return Promise.resolve({ data: 1, error: null });
    },
  }),
}));

const { CRON_EVERY_5_MIN, CRON_PAYOUT_BATCH, runCron } = await import("../cron.js");

describe("cron — escrow_auto_release dihapus (founder 2026-08-28)", () => {
  beforeEach(() => {
    control.rpcCalls = [];
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
