import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  card: null as null | { id: string; location: string; status: string; ownerId: string },
  activeShipment: null as null | Record<string, unknown>,
  inserted: null as null | Record<string, unknown>,
  insertError: null as null | { message: string },
}));

vi.mock("../../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@x.id",
        displayName: "U One",
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
      token: "t",
      aal: "aal1",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

vi.mock("../../../lib/reads/orders.js", () => ({
  getCardById: () => Promise.resolve(control.card),
  getShipmentByActiveCard: () => Promise.resolve(control.activeShipment),
}));

vi.mock("../../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "shipments") {
      return {
        insert: (row: Record<string, unknown>) => {
          control.inserted = row;
          return {
            select: () => ({
              maybeSingle: () =>
                control.insertError
                  ? Promise.resolve({ data: null, error: control.insertError })
                  : Promise.resolve({ data: row, error: null }),
            }),
          };
        },
      };
    }
    return { select: () => ({}) };
  });
  return { getSupabase: () => ({ from: fakeFrom }), readDb: () => ({ from: fakeFrom }) };
});

const { app } = await import("../../../index.js");

function post(body: Record<string, unknown>) {
  return app.request("/api/shipments/seller-to-vault", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  cardId: "card-1",
  address: "Vault C.Verse, Jl. Industri No. 99, Jakarta",
  trackingNumber: "JNEX123456",
};

describe("POST /api/shipments/seller-to-vault (P0-6)", () => {
  beforeEach(() => {
    control.card = null;
    control.activeShipment = null;
    control.inserted = null;
    control.insertError = null;
  });

  it("card dengan with_owner + owner cocok → 201 dengan shipment type secondary_seller_to_vault", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "sold", ownerId: "u-1" };
    const res = await post(BASE);
    expect(res.status).toBe(201);
    expect(control.inserted?.type).toBe("secondary_seller_to_vault");
    expect(control.inserted?.from_location).toBe("with_owner");
    expect(control.inserted?.fee_ccoin).toBe(0);
    expect(control.inserted?.tracking_number).toBe("JNEX123456");
  });

  it("card bukan milik user → 403", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "sold", ownerId: "u-other" };
    const res = await post(BASE);
    expect(res.status).toBe(403);
  });

  it("card location bukan with_owner (mis. sudah di vault) → 400", async () => {
    control.card = { id: "card-1", location: "platform_vault", status: "sold", ownerId: "u-1" };
    const res = await post(BASE);
    expect(res.status).toBe(400);
  });

  it("kartu tampered/defect/lost → 400 (paritas CARD_NOT_TRADABLE di RPC)", async () => {
    for (const status of ["tampered", "defect", "lost"]) {
      control.card = { id: "card-1", location: "with_owner", status, ownerId: "u-1" };
      const res = await post(BASE);
      expect(res.status, `status ${status}`).toBe(400);
    }
  });

  it("sudah ada shipment aktif → 409 sebelum insert", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "sold", ownerId: "u-1" };
    control.activeShipment = { id: "ship-active" };
    const res = await post(BASE);
    expect(res.status).toBe(409);
    expect(control.inserted).toBeNull();
  });

  it("race precheck vs insert (unique violation) → 409, bukan 500", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "sold", ownerId: "u-1" };
    control.insertError = { message: 'duplicate key value violates unique constraint "uq_shipments_active_per_card"' };
    const res = await post(BASE);
    expect(res.status).toBe(409);
  });

  it("alamat < 10 karakter → 400 (zValidator)", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "inventory", ownerId: "u-1" };
    const res = await post({ ...BASE, address: "pendek" });
    expect(res.status).toBe(400);
  });
});
