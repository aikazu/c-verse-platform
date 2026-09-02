import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Worker drain queue email transaksional. Mock penuh DB (../supabase.js) dan
// transport (../email.js) — konvensi sama dengan cron.test.ts. Tidak ada kirim
// nyata dan tidak ada DB nyata di unit test.

const control = vi.hoisted(() => ({
  pendingRows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; id: string }>,
  selectError: null as { message: string } | null,
  sendResults: [] as Array<{ sent: boolean; reason?: string }>,
  sendError: undefined as unknown,
  sentInputs: [] as Array<{ to: string; subject: string; text: string; html: string }>,
}));

vi.mock("./supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      // Builder supabase-js: limit() adalah ujung chain select -> resolve di sana
      // (tanpa properti `then` agar lolos aturan noThenProperty).
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: control.pendingRows, error: control.selectError }),
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            control.updates.push({ table, values, id });
            return Promise.resolve({ error: null });
          },
        }),
      };
      return builder;
    },
  }),
}));

vi.mock("./email.js", () => ({
  sendEmail: (input: { to: string; subject: string; text: string; html: string }) => {
    const result = control.sendResults.shift() ?? { sent: true };
    if (control.sendError !== undefined) return Promise.reject(control.sendError);
    control.sentInputs.push(input);
    return Promise.resolve(result);
  },
}));

const { drainEmailQueue } = await import("./emailQueue.js");

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "q-1",
    user_id: "u-1",
    template_key: "topup_settled",
    payload: { amount: 100, balance: 250 },
    attempts: 0,
    users: { email: "user@test.dev" },
    ...overrides,
  };
}

function resetEnv(enabled: boolean) {
  const g = globalThis as unknown as Record<string, string | undefined>;
  if (enabled) g.EMAIL_ENABLED = "true";
  else delete g.EMAIL_ENABLED;
}

describe("lib/emailQueue drainEmailQueue", () => {
  beforeEach(() => {
    control.pendingRows = [];
    control.updates = [];
    control.selectError = null;
    control.sendResults = [];
    control.sendError = undefined;
    (control as unknown as { sentInputs: unknown[] }).sentInputs = [];
  });
  afterEach(() => {
    resetEnv(false);
    vi.restoreAllMocks();
  });

  it("EMAIL_ENABLED nonaktif -> { disabled:true }, DB tidak disentuh sama sekali", async () => {
    resetEnv(false);
    const result = await drainEmailQueue({});
    expect(result.disabled).toBe(true);
    expect(control.updates).toHaveLength(0);
  });

  it("antrian terkirim: render per template_key, update status 'sent'", async () => {
    resetEnv(true);
    control.pendingRows = [
      row({ id: "q-1" }),
      row({ id: "q-2", template_key: "payout_disbursed", payload: { payoutId: "po-1", amount: 40 } }),
    ];
    const result = await drainEmailQueue({});
    expect(result.sent).toBe(2);
    expect(control.updates).toHaveLength(2);
    expect(control.updates.every((u) => u.values.status === "sent")).toBe(true);
    const inputs = (control as unknown as { sentInputs: Array<{ to: string; subject: string }> }).sentInputs;
    expect(inputs[0].to).toBe("user@test.dev");
    expect(inputs[1].subject).toContain("40");
  });

  it("template_key tanpa render -> attempts+1 tetap pending (retry)", async () => {
    resetEnv(true);
    control.pendingRows = [row({ id: "q-bad", template_key: "nope", attempts: 0 })];
    const result = await drainEmailQueue({});
    expect(result.retried).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("gagal kirim saat attempts=2 -> status 'failed' (cap 3 percobaan)", async () => {
    resetEnv(true);
    control.pendingRows = [row({ id: "q-fail", attempts: 2 })];
    control.sendResults = [{ sent: false, reason: "smtp_error" }];
    const result = await drainEmailQueue({});
    expect(result.failed).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("gagal kirim saat attempts<2 -> tetap pending", async () => {
    resetEnv(true);
    control.pendingRows = [row({ id: "q-retry", attempts: 0 })];
    control.sendResults = [{ sent: false, reason: "smtp_error" }];
    const result = await drainEmailQueue({});
    expect(result.retried).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("baris tanpa alamat email (users hilang) -> dianggap gagal permanen via cap", async () => {
    resetEnv(true);
    control.pendingRows = [row({ id: "q-noemail", users: null, attempts: 2 })];
    const result = await drainEmailQueue({});
    expect(result.failed).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("binding tidak tersedia (email_binding_unavailable) -> batch berhenti, sisa antrian tak disentuh", async () => {
    resetEnv(true);
    control.pendingRows = [row({ id: "q-1" }), row({ id: "q-2" })];
    control.sendResults = [{ sent: false, reason: "email_binding_unavailable" }];
    const result = await drainEmailQueue({});
    expect(result.stopped).toBe(true);
    expect(result.sent).toBe(0);
    expect(control.updates).toHaveLength(0);
    const inputs = (control as unknown as { sentInputs: unknown[] }).sentInputs;
    expect(inputs).toHaveLength(1); // hanya baris pertama dicoba
  });

  it("antrian kosong -> tanpa update, sent=0", async () => {
    resetEnv(true);
    const result = await drainEmailQueue({});
    expect(result).toMatchObject({ disabled: false, sent: 0, failed: 0, retried: 0, stopped: false });
    expect(control.updates).toHaveLength(0);
  });
});
