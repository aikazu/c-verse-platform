import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
  (globalThis as unknown as Record<string, string | undefined>).PAYOUT_WEBHOOK_SIGNING_KEY = "test-payout-signing-key";
});

// Mutable test doubles — toggled per test via the exported control object.
const control = vi.hoisted(() => ({
  signatureValid: true,
  remoteStatus: "settlement" as string,
  getStatusThrows: false,
  rpcResult: { data: { amount_ccoin: 15 }, error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as Array<Record<string, unknown>>,
  payoutRow: { status: "pending" } as { status: string } | null,
  payoutFetchErr: null as { message: string } | null,
  payoutUpdates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock("../../lib/payments/index.js", () => ({
  getProvider: () =>
    Promise.resolve({
      name: "midtrans",
      verifyNotification: () => control.signatureValid,
      getStatus: (orderId: string) => {
        if (control.getStatusThrows) return Promise.reject(new Error("network"));
        return Promise.resolve({ orderId, status: control.remoteStatus });
      },
      createTopup: () => Promise.resolve({}),
    }),
}));

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    rpc: (_fn: string, args: Record<string, unknown>) => {
      control.rpcCalls.push(args);
      return Promise.resolve(control.rpcResult);
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: control.payoutRow, error: control.payoutFetchErr }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        control.payoutUpdates.push({ table, payload });
        // Chain fixed-depth, meniru route: .eq("id", ...).eq("status", ...).
        return {
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      },
    }),
  }),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: () => Promise.resolve(),
  getKycByUser: () => Promise.resolve(null),
}));

const { app } = await import("../../index.js");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = `top-${USER_ID}-1700000000-abc123`;

function webhook(body: Record<string, unknown>) {
  return app.request("/api/payments/midtrans/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Midtrans webhook", () => {
  beforeEach(() => {
    control.signatureValid = true;
    control.remoteStatus = "settlement";
    control.getStatusThrows = false;
    control.rpcResult = { data: { amount_ccoin: 15 }, error: null };
    control.rpcCalls = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid signature with 401 and never credits", async () => {
    control.signatureValid = false;
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(401);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("ignores unknown order_id format without crediting", async () => {
    const res = await webhook({ order_id: "not-a-topup-id", gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean };
    expect(body.ignored).toBe(true);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("does not credit on pending status", async () => {
    control.remoteStatus = "pending";
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "pending" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("pending");
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("credits ceil(C-Coin) via wallet_credit with order_id as idempotency key on success", async () => {
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "155000", transaction_status: "settlement" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credited?: number };
    // 155000 / 10000 = 15.5 -> ceil 16 (docs 07 C-11: never Math.round)
    expect(body.credited).toBe(16);
    expect(control.rpcCalls).toHaveLength(1);
    expect(control.rpcCalls[0]).toMatchObject({ p_user: USER_ID, p_amount: 16, p_idem: ORDER_ID, p_ref_id: ORDER_ID });
  });

  it("reports idempotent replay when RPC returns null data", async () => {
    control.rpcResult = { data: null, error: null };
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotentReplay?: boolean };
    expect(body.idempotentReplay).toBe(true);
  });

  it("acknowledges (no infinite retry) when RPC hits non-KYC top-up cap", async () => {
    control.rpcResult = { data: null, error: { message: "TOPUP_CAP_EXCEEDED" } };
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean; reason?: string };
    expect(body.ignored).toBe(true);
    expect(body.reason).toBe("topup_cap_exceeded");
  });

  it("getStatus API throws on body-success -> 502 agar Midtrans retry (M8 audit 2026-08-24)", async () => {
    control.getStatusThrows = true;
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/retry/i);
    // No credit attempted — wallet RPC untouched.
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("getStatus API throws on body-pending -> 200 OK (no credit anyway, safe to fall back)", async () => {
    control.getStatusThrows = true;
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "pending" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("pending");
  });
});

describe("redactOrderId (M2 audit log PII)", () => {
  beforeEach(() => {
    // Reset state inherited from the previous describe block (M8 tests set
    // getStatusThrows=true, which would short-circuit before the wallet_credit
    // path that emits the redactOrderId console.error).
    control.signatureValid = true;
    control.getStatusThrows = false;
    control.remoteStatus = "settlement";
    control.rpcCalls = [];
  });

  it("menyimpan prefix top- dan random tail, menghapus user UUID", async () => {
    const { redactOrderId } = await import("../payments.js");
    const redacted = redactOrderId(ORDER_ID);
    expect(redacted).toBe("top-?…abc123");
    expect(redacted).not.toContain(USER_ID);
    expect(redacted).not.toContain("1700000000");
  });

  it("format tidak valid -> placeholder defensif tanpa bocorkan string asli", async () => {
    const { redactOrderId } = await import("../payments.js");
    expect(redactOrderId("not-a-topup-id")).toMatch(/^top-\?\(\d+\)$/);
    expect(redactOrderId("")).toMatch(/^top-\?\(\d+\)$/);
  });

  it("log PII: TOPUP_CAP_EXCEEDED tidak menuliskan user UUID ke console (M2)", async () => {
    control.rpcResult = { data: null, error: { message: "TOPUP_CAP_EXCEEDED" } };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    const logged = errSpy.mock.calls.map((c) => c.map((a) => String(a)).join(" ")).join("\n");
    expect(logged).not.toContain(USER_ID);
    expect(logged).toMatch(/top-\?…abc123/);
  });
});

const PAYOUT_ID = "payout-12345678";

function payoutWebhook(body: Record<string, unknown>) {
  return app.request("/api/payments/midtrans/payout-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature-key": "test-payout-signing-key" },
    body: JSON.stringify(body),
  });
}

describe("payout webhook state guard (audit 2026-08-29)", () => {
  beforeEach(() => {
    control.payoutRow = { status: "pending" };
    control.payoutFetchErr = null;
    control.payoutUpdates = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("finalizes pending -> disbursed on paid", async () => {
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(200);
    expect(control.payoutUpdates).toHaveLength(1);
    expect(control.payoutUpdates[0].payload).toMatchObject({ status: "disbursed" });
  });

  it("finalizes processing -> failed on failed", async () => {
    control.payoutRow = { status: "processing" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "failed" });
    expect(res.status).toBe(200);
    expect(control.payoutUpdates).toHaveLength(1);
    expect(control.payoutUpdates[0].payload).toMatchObject({ status: "failed" });
  });

  it("ignores webhook on terminal refunded payout (no update)", async () => {
    control.payoutRow = { status: "refunded" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean };
    expect(body.ignored).toBe(true);
    expect(control.payoutUpdates).toHaveLength(0);
  });

  it("blocks failed -> disbursed replay (no update)", async () => {
    control.payoutRow = { status: "failed" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean };
    expect(body.ignored).toBe(true);
    expect(control.payoutUpdates).toHaveLength(0);
  });

  it("blocks disbursed -> failed flip (no update)", async () => {
    control.payoutRow = { status: "disbursed" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "failed" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored?: boolean };
    expect(body.ignored).toBe(true);
    expect(control.payoutUpdates).toHaveLength(0);
  });

  it("404 when payout id unknown (no update)", async () => {
    control.payoutRow = null;
    control.payoutFetchErr = { message: "PGRST116" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(404);
    expect(control.payoutUpdates).toHaveLength(0);
  });

  it("ignores unknown status values (no update)", async () => {
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "weird" });
    expect(res.status).toBe(200);
    expect(control.payoutUpdates).toHaveLength(0);
  });
});
