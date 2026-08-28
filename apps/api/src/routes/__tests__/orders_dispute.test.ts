import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  order: {
    id: "order-1",
    userId: "u-1",
    cardId: "card-1",
    dropId: "drop-1",
    status: "settled",
    deliveryOption: "vault",
  } as { id: string; userId: string; cardId: string | null; status: string; deliveryOption: string },
  disputeInserts: [] as Array<Record<string, unknown>>,
  disputeInsertError: null as { message: string } | null,
}));

vi.mock("../../lib/auth.js", () => ({
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "u-1",
        email: "u@cverse.id",
        displayName: "User",
        role: "user",
        username: null,
        usernameIsAuto: true,
      },
      token: "t",
    }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../lib/reads/orders.js", () => ({
  getCardById: () => Promise.resolve(null),
  getOrderById: () => Promise.resolve(control.order),
  listOrdersByUser: () => Promise.resolve([]),
  listShipmentsByCards: () => Promise.resolve([]),
  listShipmentsByRequester: () => Promise.resolve([]),
  getShipmentById: () => Promise.resolve(null),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: () => Promise.resolve(),
}));

vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        control.disputeInserts.push(row);
        return control.disputeInsertError ? Promise.resolve({ error: control.disputeInsertError }) : Promise.resolve({ error: null });
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  }),
  _resetSupabaseCache: () => undefined,
}));

const { app } = await import("../../index.js");

function dispute(body: Record<string, unknown>) {
  return app.request("/api/orders/order-1/dispute", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("dispute gate — settled orders tetap bisa dibuka dispute (founder 2026-08-28)", () => {
  beforeEach(() => {
    control.order = { id: "order-1", userId: "u-1", cardId: "card-1", status: "settled", deliveryOption: "vault" };
    control.disputeInserts = [];
    control.disputeInsertError = null;
  });

  it("order settled -> dispute 201 tercatat", async () => {
    const res = await dispute({ reason: "Kartu diterima dalam kondisi rusak pada sudut kanan" });
    expect(res.status).toBe(201);
    expect(control.disputeInserts).toHaveLength(1);
    expect(control.disputeInserts[0]?.status).toBe("open");
    const body = (await res.json()) as { dispute: { id: string; status: string } };
    expect(body.dispute.status).toBe("open");
  });

  it("order delivered (legacy shipping) -> dispute 201", async () => {
    control.order = { ...control.order, status: "delivered" };
    const res = await dispute({ reason: "Kartu tidak pernah tiba setelah 30 hari menunggu" });
    expect(res.status).toBe(201);
  });

  it("order refunded -> tetap diblok 409", async () => {
    control.order = { ...control.order, status: "refunded" };
    const res = await dispute({ reason: "Kartu diterima dalam kondisi rusak pada sudut kanan" });
    expect(res.status).toBe(409);
    expect(control.disputeInserts).toHaveLength(0);
  });
});
