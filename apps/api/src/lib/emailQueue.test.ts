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
  sentBindings: [] as Array<Record<string, unknown> | undefined>,
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
  sendEmail: (input: { to: string; subject: string; text: string; html: string }, env?: Record<string, unknown>) => {
    const result = control.sendResults.shift() ?? { sent: true };
    if (control.sendError !== undefined) return Promise.reject(control.sendError);
    control.sentInputs.push(input);
    control.sentBindings.push(env);
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

function clearGlobalEnv() {
  const g = globalThis as unknown as Record<string, string | undefined>;
  delete g.EMAIL_ENABLED;
  delete process.env.EMAIL_ENABLED;
}

function enabledWorkerEnv() {
  return {
    EMAIL_ENABLED: "true",
    EMAIL_FROM: "no-reply@c-verse.co",
    EMAIL: { send: vi.fn() },
  };
}

describe("lib/emailQueue drainEmailQueue", () => {
  beforeEach(() => {
    control.pendingRows = [];
    control.updates = [];
    control.selectError = null;
    control.sendResults = [];
    control.sendError = undefined;
    (control as unknown as { sentInputs: unknown[] }).sentInputs = [];
    (control as unknown as { sentBindings: unknown[] }).sentBindings = [];
    clearGlobalEnv();
  });
  afterEach(() => {
    clearGlobalEnv();
    vi.restoreAllMocks();
  });

  it("EMAIL_ENABLED nonaktif -> { disabled:true }, DB tidak disentuh sama sekali", async () => {
    const result = await drainEmailQueue({ EMAIL_ENABLED: "false" });
    expect(result.disabled).toBe(true);
    expect(control.updates).toHaveLength(0);
  });

  it("antrian terkirim: render per template_key, update status 'sent'", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [
      row({ id: "q-1" }),
      row({ id: "q-2", template_key: "payout_disbursed", payload: { payoutId: "po-1", amount: 40 } }),
    ];
    const result = await drainEmailQueue(env);
    expect(result.sent).toBe(2);
    expect(control.updates).toHaveLength(2);
    expect(control.updates.every((u) => u.values.status === "sent")).toBe(true);
    const inputs = (control as unknown as { sentInputs: Array<{ to: string; subject: string }> }).sentInputs;
    expect(inputs[0].to).toBe("user@test.dev");
    expect(inputs[1].subject).toContain("40");
    expect(control.sentBindings).toEqual([
      expect.objectContaining({ EMAIL_ENABLED: "true", EMAIL_FROM: "no-reply@c-verse.co", EMAIL: env.EMAIL }),
      expect.objectContaining({ EMAIL_ENABLED: "true", EMAIL_FROM: "no-reply@c-verse.co", EMAIL: env.EMAIL }),
    ]);
  });

  it("template_key tanpa render -> attempts+1 tetap pending (retry)", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [row({ id: "q-bad", template_key: "nope", attempts: 0 })];
    const result = await drainEmailQueue(env);
    expect(result.retried).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("gagal kirim saat attempts=2 -> status 'failed' (cap 3 percobaan)", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [row({ id: "q-fail", attempts: 2 })];
    control.sendResults = [{ sent: false, reason: "smtp_error" }];
    const result = await drainEmailQueue(env);
    expect(result.failed).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("gagal kirim saat attempts<2 -> tetap pending", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [row({ id: "q-retry", attempts: 0 })];
    control.sendResults = [{ sent: false, reason: "smtp_error" }];
    const result = await drainEmailQueue(env);
    expect(result.retried).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("baris tanpa alamat email (users hilang) -> dianggap gagal permanen via cap", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [row({ id: "q-noemail", users: null, attempts: 2 })];
    const result = await drainEmailQueue(env);
    expect(result.failed).toBe(1);
    expect(control.updates[0].values).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("binding tidak tersedia (email_binding_unavailable) -> batch berhenti, sisa antrian tak disentuh", async () => {
    const env = enabledWorkerEnv();
    control.pendingRows = [row({ id: "q-1" }), row({ id: "q-2" })];
    control.sendResults = [{ sent: false, reason: "email_binding_unavailable" }];
    const result = await drainEmailQueue(env);
    expect(result.stopped).toBe(true);
    expect(result.sent).toBe(0);
    expect(control.updates).toHaveLength(0);
    const inputs = (control as unknown as { sentInputs: unknown[] }).sentInputs;
    expect(inputs).toHaveLength(1); // hanya baris pertama dicoba
  });

  it("antrian kosong -> tanpa update, sent=0", async () => {
    const result = await drainEmailQueue(enabledWorkerEnv());
    expect(result).toMatchObject({ disabled: false, sent: 0, failed: 0, retried: 0, stopped: false });
    expect(control.updates).toHaveLength(0);
  });
});
