import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

vi.mock("../../lib/auth.js", () => ({
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
}));

vi.mock("../../lib/reads/wallet.js", () => ({
  getWallet: () =>
    Promise.resolve({
      userId: "user-1",
      balanceCCoin: 120,
      totalTopupCCoin: 200,
      totalSpentCCoin: 80,
    }),
  listWalletTxs: () =>
    Promise.resolve([
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
    ]),
  isPayoutHeld: () => Promise.resolve({ held: false, until: null }),
}));

const { app } = await import("../../index.js");

describe("Wallet routes", () => {
  it("GET /api/wallet returns wallet data for authenticated user", async () => {
    const res = await app.request("/api/wallet", {
      headers: { Authorization: "Bearer mock-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wallet: { balanceCCoin: number } };
    expect(body.wallet).toBeDefined();
    expect(body.wallet.balanceCCoin).toBe(120);
  });

  it("GET /api/wallet returns disclosure statement", async () => {
    const res = await app.request("/api/wallet");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disclosureOpsiA?: string };
    expect(body.disclosureOpsiA).toBeDefined();
    expect(body.disclosureOpsiA).toContain("closed-loop");
  });
});
