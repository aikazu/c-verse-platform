import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// GET /api/profile mengembalikan row KYC milik sendiri — NIK/address harus
// melewati redactKycForOwner (paritas dengan GET /api/kyc, audit batch 2 F6).
const control = vi.hoisted(() => ({
  kyc: null as null | Record<string, unknown>,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@cverse.id",
        displayName: "User One",
        role: "user",
        username: "userone",
        usernameIsAuto: false,
        xp: 0,
        totalXp: 5,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "t",
      aal: "aal1",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  getKycByUser: vi.fn(() => Promise.resolve(control.kyc)),
}));
vi.mock("../../../lib/reads/profile.js", () => ({
  getWalletByUser: vi.fn(() =>
    Promise.resolve({ userId: "u-1", balanceCCoin: 100, totalTopupCCoin: 100, totalSpentCCoin: 0, holdPayoutUntil: null }),
  ),
  listUserBadges: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  listCards: vi.fn(() => Promise.resolve([])),
  listDrops: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/orders.js", () => ({
  listOrdersByUser: vi.fn(() => Promise.resolve([])),
  listShipmentsByRequester: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../lib/reads/bids.js", () => ({
  listBids: vi.fn(() => Promise.resolve([])),
}));

const { app } = await import("../../../index.js");

function getProfile() {
  return app.request("/api/profile", { headers: { authorization: "Bearer t" } });
}

describe("GET /api/profile — KYC PII redaction (audit batch 2 F6)", () => {
  beforeEach(() => {
    control.kyc = {
      id: "kyc-1",
      userId: "u-1",
      fullName: "Budi Santoso",
      nik: "3201234567890001",
      address: "Jl. Merdeka No. 17, Jakarta",
      status: "pending",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      dob: "1990-05-12",
      ktpUrl: "https://storage.example/ktp.jpg",
      npwpUrl: null,
      selfieUrl: "https://storage.example/selfie.jpg",
    };
    vi.clearAllMocks();
  });

  it("NIK di-mask (12 bintang + 4 digit akhir)", async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc: { nik: string } | null };
    expect(body.kyc?.nik).toBe("************0001");
    expect(body.kyc?.nik).not.toContain("3201234567890001");
  });

  it("address jadi placeholder [redacted]", async () => {
    const res = await getProfile();
    const body = (await res.json()) as { kyc: { address: string } | null };
    expect(body.kyc?.address).toBe("[redacted]");
  });

  it("tanpa row KYC → kyc null (bukan error)", async () => {
    control.kyc = null;
    const res = await getProfile();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kyc: unknown };
    expect(body.kyc).toBeNull();
  });
});
