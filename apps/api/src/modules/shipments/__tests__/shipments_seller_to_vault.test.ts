import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  // snake_case fields because mapCardRow reads raw DB rows from .select("*").
  card: null as null | { id: string; location: string; status: string; owner_id: string },
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

vi.mock("../../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table === "cards") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: control.card, error: null }),
          }),
        }),
      };
    }
    if (table === "shipments") {
      return {
        insert: (row: Record<string, unknown>) => {
          if (control.insertError) {
            return Promise.resolve({ data: null, error: control.insertError });
          }
          control.inserted = row;
          return {
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
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
    control.inserted = null;
    control.insertError = null;
  });

  it("card dengan with_owner + owner cocok → 201 dengan shipment type secondary_seller_to_vault", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "inventory", owner_id: "u-1" };
    const res = await post(BASE);
    expect(res.status).toBe(201);
    expect(control.inserted?.type).toBe("secondary_seller_to_vault");
    expect(control.inserted?.tracking_number).toBe("JNEX123456");
  });

  it("card bukan milik user → 403", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "inventory", owner_id: "u-other" };
    const res = await post(BASE);
    expect(res.status).toBe(403);
  });

  it("card location bukan with_owner (mis. sudah di vault) → 400", async () => {
    control.card = { id: "card-1", location: "platform_vault", status: "inventory", owner_id: "u-1" };
    const res = await post(BASE);
    expect(res.status).toBe(400);
  });

  it("alamat < 10 karakter → 400 (zValidator)", async () => {
    control.card = { id: "card-1", location: "with_owner", status: "inventory", owner_id: "u-1" };
    const res = await post({ ...BASE, address: "pendek" });
    expect(res.status).toBe(400);
  });
});
