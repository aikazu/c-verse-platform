import { describe, expect, it } from "vitest";
import {
  baseUrl,
  buildSignatureKey,
  createMidtransProvider,
  MIDTRANS_SNAP_PATH,
  mapTransactionStatus,
  verifyNotificationSignature,
} from "./midtrans";

// Matriks docs/14 §5 + docs/15 §3.2 (signature builder, status map, idempotency replay).

const SERVER_KEY = "SB-Mid-server-TEST";

describe("signature", () => {
  it("builds sha512(order_id + status_code + gross_amount + server_key)", () => {
    const sig = buildSignatureKey("top-1-1700000000-ab12", "200", "10000.00", SERVER_KEY);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    // deterministik & bergantung pada seluruh input
    expect(sig).toBe(buildSignatureKey("top-1-1700000000-ab12", "200", "10000.00", SERVER_KEY));
    expect(sig).not.toBe(buildSignatureKey("top-1-1700000000-ab13", "200", "10000.00", SERVER_KEY));
    expect(sig).not.toBe(buildSignatureKey("top-1-1700000000-ab12", "200", "10000.00", "SB-Mid-server-OTHER"));
  });

  it("verifies notification payload (wrong signature -> false)", () => {
    const payload = {
      orderId: "top-1-1700000000-ab12",
      statusCode: "200",
      grossAmount: "10000.00",
      status: "settlement",
      signatureKey: buildSignatureKey("top-1-1700000000-ab12", "200", "10000.00", SERVER_KEY),
      raw: {},
    };
    expect(verifyNotificationSignature(payload, SERVER_KEY)).toBe(true);
    expect(verifyNotificationSignature({ ...payload, signatureKey: "deadbeef" }, SERVER_KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...payload, signatureKey: undefined }, SERVER_KEY)).toBe(false);
  });
});

describe("mapTransactionStatus", () => {
  it("settlement/capture -> success", () => {
    expect(mapTransactionStatus("settlement")).toBe("success");
    expect(mapTransactionStatus("capture")).toBe("success");
  });
  it("pending/challenge -> pending", () => {
    expect(mapTransactionStatus("pending")).toBe("pending");
  });
  it("deny/cancel/expire -> fail", () => {
    expect(mapTransactionStatus("deny")).toBe("fail");
    expect(mapTransactionStatus("cancel")).toBe("fail");
    expect(mapTransactionStatus("expire")).toBe("fail");
  });
});

describe("MidtransProvider (fetch mocked)", () => {
  function mockProvider(responses: Record<string, unknown>) {
    const calls: { path: string; body?: unknown }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = responses[path];
      return new Response(JSON.stringify(body ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    return { provider: createMidtransProvider({ serverKey: SERVER_KEY, isProduction: false, fetchImpl }), calls };
  }

  it("createTopup posts to Snap with Basic auth + returns token", async () => {
    const { provider, calls } = mockProvider({
      [MIDTRANS_SNAP_PATH]: { token: "snap-token-1", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/snap-token-1" },
    });
    const instruction = await provider.createTopup({ orderId: "top-1-1-ab", amountIdr: 100000, amountCcoin: 10, userId: "u" });
    expect(instruction.snapToken).toBe("snap-token-1");
    expect(instruction.redirectUrl).toContain("snap-token-1");
    expect(calls[0]?.path).toBe(MIDTRANS_SNAP_PATH);
    expect((calls[0]?.body as { transaction_details: { order_id: string } }).transaction_details.order_id).toBe("top-1-1-ab");
  });

  it("getStatus queries status endpoint", async () => {
    const { provider } = mockProvider({ "/v2/top-1-1-ab/status": { transaction_status: "settlement", payment_type: "qris" } });
    const res = await provider.getStatus("top-1-1-ab");
    expect(res.status).toBe("settlement");
    expect(res.paymentType).toBe("qris");
  });

  it("sandbox vs production base url", () => {
    expect(baseUrl(false)).toContain("sandbox");
    expect(baseUrl(true)).not.toContain("sandbox");
  });
});
