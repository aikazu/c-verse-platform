import { C_COIN_RATE_IDR, MIN_PAYOUT_CCOIN } from "@c-verse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "user-1",
        email: "test@cverse.id",
        displayName: "Test",
        role: "user",
        username: null,
        usernameIsAuto: true,
        xp: 0,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "mock-token",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

const control = vi.hoisted(() => ({
  wallet: {
    userId: "user-1",
    balanceCCoin: 120,
    totalTopupCCoin: 200,
    totalSpentCCoin: 80,
    holdPayoutUntil: null,
  },
  txs: [
    {
      id: "tx-1",
      userId: "user-1",
      type: "top_up",
      amountCCoin: 100,
      balanceAfterCCoin: 200,
      refType: null,
      refId: null,
      note: null,
      createdAt: new Date().toISOString(),
    },
  ],
  payoutHeld: { held: false, until: null as string | null },
}));

const reads = vi.hoisted(() => ({
  getWallet: vi.fn(() => Promise.resolve(control.wallet)),
  listWalletTxs: vi.fn(() => Promise.resolve(control.txs)),
  listGemTxs: vi.fn(() => Promise.resolve([])),
  isPayoutHeld: vi.fn(() => Promise.resolve(control.payoutHeld)),
}));

vi.mock("../reads.js", () => reads);

const { app } = await import("../../../index.js");

describe("Wallet routes", () => {
  beforeEach(() => {
    control.payoutHeld = { held: false, until: null };
    vi.clearAllMocks();
  });

  it("GET /api/wallet scopes reads to the caller and derives idr equivalent", async () => {
    const res = await app.request("/api/wallet", {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      wallet: { balanceCCoin: number; balanceIdrEquiv: number };
      transactions: Array<{ id: string }>;
      topupCapNoKyc: number;
      minPayout: number;
      payoutHeld: boolean;
      payoutHoldUntil: string | null;
    };

    // camelCase mapping passthrough + DERIVED idr equivalent (not echoed by the mock)
    expect(body.wallet.balanceCCoin).toBe(120);
    expect(body.wallet.balanceIdrEquiv).toBe(120 * C_COIN_RATE_IDR);

    // owner scoping: every read is keyed to the authenticated user id only
    expect(reads.getWallet).toHaveBeenCalledTimes(1);
    expect(reads.getWallet).toHaveBeenCalledWith("user-1");
    expect(reads.listWalletTxs).toHaveBeenCalledWith("user-1", 100);
    expect(reads.isPayoutHeld).toHaveBeenCalledWith("user-1");

    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].id).toBe("tx-1");
    // Pin the literal — asserting the shared constant against itself is tautological.
    expect(body.topupCapNoKyc).toBe(500);
    expect(body.minPayout).toBe(MIN_PAYOUT_CCOIN);
    expect(body.payoutHeld).toBe(false);
    expect(body.payoutHoldUntil).toBeNull();
  });

  it("GET /api/wallet surfaces fraud hold from isPayoutHeld", async () => {
    control.payoutHeld = { held: true, until: "2026-09-01T00:00:00.000Z" };
    const res = await app.request("/api/wallet", {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { payoutHeld: boolean; payoutHoldUntil: string | null };
    expect(body.payoutHeld).toBe(true);
    expect(body.payoutHoldUntil).toBe("2026-09-01T00:00:00.000Z");
  });

  it("GET /api/wallet returns disclosure statement", async () => {
    const res = await app.request("/api/wallet");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disclosureOpsiA?: string };
    expect(body.disclosureOpsiA).toBeDefined();
    expect(body.disclosureOpsiA).toContain("closed-loop");
  });
});
