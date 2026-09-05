import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  access: "admin" as "guest" | "user" | "suspended" | "admin",
  readCalls: [] as string[],
  readError: null as Error | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: () => {
    if (control.access === "guest") return Promise.resolve({ error: 401 });
    if (control.access === "user") return Promise.resolve({ error: 403, reason: "not_admin" });
    if (control.access === "suspended") return Promise.resolve({ error: 403, reason: "suspended" });
    return Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
        username: null,
        usernameIsAuto: true,
        totalXp: 0,
        level: 1,
        cumulativeSpendCcoin: 0,
        isAnonymous: false,
        flagReason: null,
        consentAnalyticsDetail: false,
        consentDataMarket: false,
        createdAt: new Date().toISOString(),
      },
      token: "admin-token",
    });
  },
  requireUser: () => Promise.resolve({ error: 401 }),
  adminGateError: (result: { error: number; reason?: string }) => ({
    body: { error: result.reason === "suspended" ? "Akun disuspend" : result.error === 403 ? "Admin access required" : "Unauthorized" },
    status: result.error,
  }),
  tokenFingerprint: () => Promise.resolve("sha256:test"),
  clientIp: () => "127.0.0.1",
}));

vi.mock("../reads.js", () => {
  const result = <T>(name: string, data: T) => {
    control.readCalls.push(name);
    if (control.readError) return Promise.reject(control.readError);
    return Promise.resolve(data);
  };
  return {
    getAdminDashboard: () =>
      result("dashboard", {
        stats: { drops: 2, orders: 3, creators: 1 },
        counts: { shipmentsActionable: 4, kycPending: 5, disputesOpen: 6, payoutsPending: 7 },
      }),
    getAdminDrops: () =>
      result("drops", {
        drops: [{ id: "drop-1", title: "Drop Satu", status: "draft", total_units: 15 }],
        activeCreators: [{ user_id: "creator-user-1", handle: "karina", users: { display_name: "Karina" } }],
      }),
    getAdminCreators: () =>
      result("creators", {
        creators: [{ id: "creator-1", user_id: "creator-user-1", handle: "karina", status: "active" }],
        users: [{ id: "creator-user-1", email: "karina@example.com", role: "creator", flag_reason: null }],
        wallets: [{ user_id: "creator-user-1", hold_payout_until: null }],
      }),
    getAdminOrders: () =>
      result("orders", {
        orders: [{ id: "order-1", card_id: "card-1", status: "paid", delivery_option: "shipping" }],
        shipments: [
          {
            id: "shipment-1",
            card_id: "card-1",
            requester_id: "seller-1",
            type: "secondary_seller_to_vault",
            from_location: "with_owner",
            to_dest: "platform_vault",
            address: { street: "Jalan C.Verse 1" },
            status: "requested",
            tracking_number: null,
          },
        ],
      }),
    getAdminPayouts: () =>
      result("payouts", {
        batches: [{ id: "batch-1", batch_code: "PAY-1", status: "processing", total_ccoin: 10, total_idr: 99000 }],
        payouts: [{ id: "payout-1", user_id: "creator-user-1", type: "creator", ccoin_amount: 10, status: "pending", batch_id: "batch-1" }],
      }),
    getAdminNfc: () =>
      result("nfc", {
        batches: [{ id: "nfc-batch-1", batch_code: "NFC-1", qty: 20, status: "received" }],
        cards: [{ id: "card-1", nfc_short_id: "AB12", verify_status: "verified" }],
        seedPending: [
          { id: "card-seed-1", drop_id: "drop-seed-1", status: "bid_pending", location: "with_owner", drops: { is_seed: true } },
        ],
      }),
    getAdminInvestor: (token: string) =>
      result("investor", {
        stats: { users: 10, gmvCcoin: 500, secondaryVolCcoin: 120, txCount: 9, token },
        drops: [{ id: "drop-1", title: "Drop Satu", status: "live", total_units: 15, sold_count: 4 }],
      }),
  };
});

vi.mock("../../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));
vi.mock("../../../lib/supabase.js", () => ({ getSupabase: () => ({ from: () => ({}) }) }));
vi.mock("../../../lib/email.js", () => ({ sendCreatorAccessEmail: () => Promise.resolve({ sent: false, reason: "disabled" }) }));

const { app } = await import("../../../index.js");

const endpoints = ["dashboard", "drops", "creators", "orders", "payouts", "nfc", "investor"] as const;

function get(endpoint: (typeof endpoints)[number]) {
  return app.request(`/api/admin/${endpoint}`, { headers: { Authorization: "Bearer admin-token" } });
}

describe("admin read endpoints", () => {
  beforeEach(() => {
    control.access = "admin";
    control.readCalls = [];
    control.readError = null;
  });

  it.each(["guest", "user", "suspended"] as const)("menolak %s untuk seluruh data operasional", async (access) => {
    control.access = access;
    const responses = await Promise.all(endpoints.map((endpoint) => get(endpoint)));

    for (const response of responses) {
      expect(response.status).toBe(access === "guest" ? 401 : 403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(control.readCalls).toEqual([]);
  });

  it("mengirim bentuk data admin yang diproyeksikan dan tidak dapat di-cache publik", async () => {
    const responses = await Promise.all(endpoints.map(async (endpoint) => [endpoint, await get(endpoint)] as const));
    const payloads = new Map(await Promise.all(responses.map(async ([endpoint, response]) => [endpoint, await response.json()] as const)));

    for (const [, response] of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(control.readCalls).toEqual([...endpoints]);
    expect(payloads.get("dashboard")).toMatchObject({ stats: { drops: 2 }, counts: { payoutsPending: 7 } });
    expect(payloads.get("drops")).toMatchObject({
      drops: [{ id: "drop-1", total_units: 15 }],
      activeCreators: [{ user_id: "creator-user-1", users: { display_name: "Karina" } }],
    });
    expect(payloads.get("creators")).toMatchObject({
      users: [{ email: "karina@example.com", flag_reason: null }],
      wallets: [{ user_id: "creator-user-1", hold_payout_until: null }],
    });
    expect(payloads.get("orders")).toMatchObject({
      shipments: [{ card_id: "card-1", requester_id: "seller-1", to_dest: "platform_vault", address: { street: "Jalan C.Verse 1" } }],
    });
    expect(payloads.get("payouts")).toMatchObject({ payouts: [{ id: "payout-1", batch_id: "batch-1" }] });
    expect(payloads.get("nfc")).toMatchObject({ seedPending: [{ drops: { is_seed: true } }] });
    expect(payloads.get("investor")).toMatchObject({ stats: { users: 10, token: "admin-token" }, drops: [{ sold_count: 4 }] });
  });

  it("menyaring kegagalan selector", async () => {
    control.readError = new Error('column "secret_admin_note" does not exist');
    const response = await get("orders");

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Operasi gagal");
    expect(body.error).not.toContain("secret_admin_note");
  });
});
