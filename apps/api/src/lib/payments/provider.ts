// Payment provider abstraction (docs/14 §1: Midtrans primary, Xendis backup Y2 —
// satu interface, jangan dua implementasi paralel).

export type TopupStatus = "success" | "pending" | "fail";

export interface CreateTopupArgs {
  orderId: string;
  amountIdr: number;
  amountCcoin: number;
  userId: string;
}

export interface TopupInstruction {
  snapToken: string | null;
  redirectUrl: string | null;
  expiresInMinutes: number;
}

export interface NotificationPayload {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  status: string;
  signatureKey?: string;
  paymentType?: string;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  createTopup(args: CreateTopupArgs): Promise<TopupInstruction>;
  /** Ambil status transaksi langsung dari gateway (jangan percaya body webhook saja). */
  getStatus(orderId: string): Promise<{ status: string; paymentType?: string }>;
  verifyNotification(payload: NotificationPayload): boolean;
  registerBeneficiary(args: { name: string; bankAccount: string }): Promise<{ beneficiaryId: string }>;
  disburse(args: { beneficiaryId: string; amountIdr: number; reference: string }): Promise<{ status: "queued" | "paid" | "failed" }>;
}
