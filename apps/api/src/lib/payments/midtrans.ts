import { createHash, timingSafeEqual } from "node:crypto";
import type { CreateTopupArgs, NotificationPayload, PaymentProvider, TopupInstruction, TopupStatus } from "./provider.js";

// Midtrans impl (docs/14 §2): Snap top-up + signature verify + status API + IRIS disbursement.
// Fetch injectable supaya unit test bisa mock (tanpa network).

export const MIDTRANS_SNAP_PATH = "/snap/v1/transactions";
export const MIDTRANS_STATUS_PATH = "/v2";

/** sha512(order_id + status_code + gross_amount + server_key) — spec Midtrans notification. */
export function buildSignatureKey(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

export function verifyNotificationSignature(payload: NotificationPayload, serverKey: string): boolean {
  if (!payload.signatureKey) return false;
  const expected = buildSignatureKey(payload.orderId, payload.statusCode, payload.grossAmount, serverKey);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(payload.signatureKey, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** settlement|capture -> success; pending -> pending; deny|cancel|expire -> fail. */
export function mapTransactionStatus(status: string): TopupStatus {
  const s = status.toLowerCase();
  if (["settlement", "capture"].includes(s)) return "success";
  if (["pending", "challenge"].includes(s)) return "pending";
  return "fail"; // deny | cancel | expire | lainnya
}

export function isSandbox(isProduction: boolean | undefined): boolean {
  return !isProduction;
}

export function baseUrl(isProduction: boolean | undefined): string {
  return isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
}

export interface MidtransOptions {
  serverKey: string;
  isProduction?: boolean;
  fetchImpl?: typeof fetch;
}

export function createMidtransProvider(opts: MidtransOptions): PaymentProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const authHeader = `Basic ${Buffer.from(`${opts.serverKey}:`).toString("base64")}`;

  async function midtransFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await doFetch(`${baseUrl(opts.isProduction)}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authHeader, ...(init.headers ?? {}) },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Midtrans ${path} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  }

  return {
    name: "midtrans",

    async createTopup(args: CreateTopupArgs): Promise<TopupInstruction> {
      const data = await midtransFetch(MIDTRANS_SNAP_PATH, {
        method: "POST",
        body: JSON.stringify({
          transaction_details: { order_id: args.orderId, gross_amount: args.amountIdr },
          item_details: [{ id: `ccoin-${args.amountCcoin}`, price: args.amountIdr, quantity: 1, name: `${args.amountCcoin} C-Coin` }],
          expiry: { unit: "hour", duration: 1 }, // docs/14 §2.2: batas waktu Snap 1 jam
        }),
      });
      return {
        snapToken: (data.token as string) ?? null,
        redirectUrl: (data.redirect_url as string) ?? null,
        expiresInMinutes: 60,
      };
    },

    async getStatus(orderId: string) {
      const data = await midtransFetch(`${MIDTRANS_STATUS_PATH}/${encodeURIComponent(orderId)}/status`, { method: "GET" });
      return { status: String(data.transaction_status ?? "unknown"), paymentType: data.payment_type as string | undefined };
    },

    verifyNotification(payload: NotificationPayload): boolean {
      return verifyNotificationSignature(payload, opts.serverKey);
    },

    async registerBeneficiary(args: { name: string; bankAccount: string }) {
      // IRIS beneficiary API — dipakai saat KYC approve (docs/14 §3.1)
      const data = await midtransFetch("/iris/api/v1/beneficiaries", {
        method: "POST",
        body: JSON.stringify({ name: args.name, account: args.bankAccount }),
      });
      return { beneficiaryId: String(data.beneficiary_id ?? "") };
    },

    async disburse(args: { beneficiaryId: string; amountIdr: number; reference: string }) {
      const data = await midtransFetch("/iris/api/v1/payouts", {
        method: "POST",
        body: JSON.stringify({ beneficiary_id: args.beneficiaryId, amount: args.amountIdr, notes: args.reference }),
      });
      const status = String(data.status ?? "queued").toLowerCase();
      return { status: status === "paid" ? "paid" : status === "failed" ? "failed" : "queued" };
    },
  };
}
