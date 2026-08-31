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
  // Pentest P2: make getSupabase()/db.rpc() throw so the uncaught error travels
  // through the root app onError handler.
  supabaseThrow: null as Error | null,
  rpcReject: null as Error | null,
  payoutRow: { status: "pending" } as { status: string } | null,
  refundRow: { id: "payout-12345678", status: "pending", user_id: "11111111-1111-4111-8111-111111111111", ccoin_amount: 10 } as Record<
    string,
    unknown
  > | null,
  payoutFetchErr: null as { message: string } | null,
  payoutUpdates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  // Lane E (audit 2026-08-31): guarded update bisa 0 baris (race) — route wajib
  // memeriksa affected rows dan menulis audit payout_webhook.
  payoutUpdateResult: { data: [{ id: "payout-12345678" }], error: null } as { data: unknown; error: { message: string } | null },
  logAuditCalls: [] as Array<unknown[]>,
}));

vi.mock("../../../lib/payments/index.js", () => ({
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

// Pentest P2: auth gates are unit-stubbed so admin-only routes (payout refund)
// are reachable without a real Supabase JWT/MFA — the seam under test is the
// error sanitizer, not authentication.
vi.mock("../../../lib/auth.js", () => ({
  requireUser: () => Promise.resolve({ user: { id: "11111111-1111-4111-8111-111111111111" }, token: "test-token" }),
  requireAdmin: () => Promise.resolve({ user: { id: "22222222-2222-4222-8222-222222222222", role: "admin" }, token: "admin-token" }),
  getOptionalUser: () => Promise.resolve(null),
  authHeaderToToken: () => "test-token",
  verifySupabaseJwt: () => Promise.resolve(null),
  adminGateError: (res: { error: 401 | 403; reason?: string }) =>
    res.error === 401 ? { body: { error: "Unauthorized" }, status: 401 } : { body: { error: "Hanya admin" }, status: 403 },
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("fp-test"),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => {
    if (control.supabaseThrow) throw control.supabaseThrow;
    return {
      rpc: (_fn: string, args: Record<string, unknown>) => {
        if (control.rpcReject) return Promise.reject(control.rpcReject);
        control.rpcCalls.push(args);
        return Promise.resolve(control.rpcResult);
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: control.payoutRow, error: control.payoutFetchErr }),
            maybeSingle: () => Promise.resolve({ data: control.refundRow, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          control.payoutUpdates.push({ table, payload });
          // Route chain: .update().eq("id").eq("status").select("id") — result
          // dikontrol via control.payoutUpdateResult (affected rows).
          const terminal = () => Promise.resolve(control.payoutUpdateResult);
          const level3 = { select: terminal };
          const level2 = { eq: () => level3, select: terminal };
          return { eq: () => level2, select: terminal };
        },
      }),
    };
  },
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.logAuditCalls.push(args);
    return Promise.resolve();
  },
  getKycByUser: () => Promise.resolve(null),
}));

const { app } = await import("../../../index.js");

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
    const { redactOrderId } = await import("../routes.js");
    const redacted = redactOrderId(ORDER_ID);
    expect(redacted).toBe("top-?…abc123");
    expect(redacted).not.toContain(USER_ID);
    expect(redacted).not.toContain("1700000000");
  });

  it("format tidak valid -> placeholder defensif tanpa bocorkan string asli", async () => {
    const { redactOrderId } = await import("../routes.js");
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
    control.payoutUpdateResult = { data: [{ id: PAYOUT_ID }], error: null };
    control.logAuditCalls = [];
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

  // Lane E (audit 2026-08-31): guarded update bisa memukul 0 baris saat status
  // berubah di antara fetch dan update (race dengan admin refund / batch).
  // Webhook TIDAK boleh melaporkan sukses — dan audit tidak ditulis.
  it("stale transition (0 rows affected) -> 409 ok:false, no audit", async () => {
    control.payoutUpdateResult = { data: [], error: null };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(false);
    expect(control.logAuditCalls).toHaveLength(0);
  });

  it("update DB error -> 500 sanitized, no audit", async () => {
    control.payoutUpdateResult = { data: null, error: { message: "could not serialize access due to concurrent update" } };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Operasi gagal");
    expect(control.logAuditCalls).toHaveLength(0);
  });

  it("successful transition writes system audit with before/after status", async () => {
    control.payoutRow = { status: "processing" };
    const res = await payoutWebhook({ payout_id: PAYOUT_ID, status: "paid" });
    expect(res.status).toBe(200);
    expect(control.logAuditCalls).toHaveLength(1);
    const [actor, _action, table, targetId, payload, ip, sessionId] = control.logAuditCalls[0] as [
      string,
      string,
      string,
      string,
      Record<string, unknown>,
      string | null,
      string | null,
    ];
    expect(actor).toBe("system");
    expect(table).toBe("payouts");
    expect(targetId).toBe(PAYOUT_ID);
    expect(payload).toMatchObject({ action: "payout_webhook", statusBefore: "processing", statusAfter: "disbursed" });
    expect(ip).toBeNull();
    expect(sessionId).toBeNull();
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

function payoutWebhookWithSignature(body: Record<string, unknown>, signature: string) {
  return app.request("/api/payments/midtrans/payout-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature-key": signature },
    body: JSON.stringify(body),
  });
}

// P1-1: signature gate dievaluasi SEBELUM akses DB mana pun — pemanggil tanpa
// signature valid tidak boleh memicu fetch/update state payout sama sekali.
describe("payout webhook signature gate (P1-1)", () => {
  beforeEach(() => {
    control.payoutRow = { status: "pending" };
    control.payoutFetchErr = null;
    control.payoutUpdates = [];
    control.rpcCalls = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("missing x-signature-key header -> 401 Invalid signature, no state flip", async () => {
    const res = await app.request("/api/payments/midtrans/payout-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payout_id: PAYOUT_ID, status: "paid" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid signature");
    expect(control.payoutUpdates).toHaveLength(0);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("wrong signature (same length, reaches constant-time compare) -> 401, no state flip", async () => {
    const wrong = "x".repeat("test-payout-signing-key".length);
    const res = await payoutWebhookWithSignature({ payout_id: PAYOUT_ID, status: "paid" }, wrong);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid signature");
    expect(control.payoutUpdates).toHaveLength(0);
    expect(control.rpcCalls).toHaveLength(0);
  });

  it("wrong signature (different length, short-circuit) -> 401, no state flip", async () => {
    const res = await payoutWebhookWithSignature({ payout_id: PAYOUT_ID, status: "paid" }, "short");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid signature");
    expect(control.payoutUpdates).toHaveLength(0);
    expect(control.rpcCalls).toHaveLength(0);
  });
});

// Pentest P2 (2026-08-30): raw Postgres messages (e.g. `invalid input syntax for
// type uuid: "system"`) were proven to leak through the root onError 500 body.
describe("global onError sanitization (pentest P2)", () => {
  beforeEach(() => {
    control.signatureValid = true;
    control.getStatusThrows = false;
    control.rpcReject = null;
    control.rpcCalls = [];
  });
  afterEach(() => {
    control.supabaseThrow = null;
    vi.clearAllMocks();
  });

  it("webhook 500 body never carries the raw uuid syntax error", async () => {
    control.supabaseThrow = new Error('invalid input syntax for type uuid: "system"');
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid identifier");
    expect(body.error).not.toContain("uuid");
    expect(body.error).not.toContain("system");
  });

  it("curated business code thrown to onError still reaches the client verbatim", async () => {
    control.supabaseThrow = new Error("COOLDOWN_PERIOD_24H");
    const res = await webhook({ order_id: ORDER_ID, gross_amount: "150000", transaction_status: "settlement" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("COOLDOWN_PERIOD_24H");
  });
});

// Pentest P2: POST /admin/payouts/:id/refund 500 catch-all returned raw
// `err.message` — non-RpcError DB failures must be sanitized too.
describe("admin payout refund 500 sanitization (pentest P2)", () => {
  beforeEach(() => {
    control.rpcReject = null;
    control.rpcCalls = [];
    control.refundRow = { id: PAYOUT_ID, status: "pending", user_id: USER_ID, ccoin_amount: 10 };
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function refund(payoutId: string) {
    return app.request(`/api/payments/admin/payouts/${payoutId}/refund`, { method: "POST" });
  }

  it("404 keeps business mapping when payout is unknown", async () => {
    control.refundRow = null;
    const res = await refund(PAYOUT_ID);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Payout tidak ditemukan");
  });

  it("non-RpcError DB failure -> 500 with sanitized message, never raw", async () => {
    control.rpcReject = new Error("could not serialize access due to concurrent update");
    const res = await refund(PAYOUT_ID);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("serialize");
  });

  it("raw technical failure message class (uuid syntax) -> mapped, never verbatim", async () => {
    control.rpcReject = new Error('invalid input syntax for type uuid: "system"');
    const res = await refund(PAYOUT_ID);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid identifier");
    expect(body.error).not.toContain("uuid");
  });
});
