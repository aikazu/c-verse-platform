import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  shipmentExists: true as boolean,
  shipmentStatus: "packed" as string,
  cardId: "card-1",
  trackingNumber: null as string | null,
  fulfillError: null as { code: string; message: string } | null,
  // Pelacakan call supaya bisa assert route tidak lagi menulis langsung ke shipments/orders/cards.
  fromCalls: [] as Array<{ table: string; op: string }>,
  rpcCalls: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../lib/auth.js", () => ({
  requireAdmin: () => {
    if (control.fulfillError?.code === "_AUTH_FAIL_") {
      return Promise.resolve({ error: 401 });
    }
    return Promise.resolve({
      user: {
        id: "admin-1",
        email: "admin@cverse.id",
        displayName: "Admin",
        role: "admin",
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
    });
  },
  adminGateError: (res: { error: number; reason?: string }) => {
    if (res.error === 401) return { body: { error: "Unauthorized" }, status: 401 };
    const msg = res.reason === "mfa_required" ? "MFA (aal2) wajib untuk aksi admin" : "Hanya admin";
    return { body: { error: msg }, status: 403 };
  },
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../lib/reads/kyc.js", () => ({
  logAuditDb: (...args: unknown[]) => {
    control.auditCalls.push({ args });
    return Promise.resolve();
  },
}));

vi.mock("../../lib/supabase.js", () => {
  // shipments table hanya dipakai untuk SELECT precheck (read-only); UPDATE harus lewat RPC.
  const fakeFrom = vi.fn((table: string) => {
    if (table === "shipments") {
      return {
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () =>
              control.shipmentExists
                ? Promise.resolve({
                    data: {
                      id: "ship-1",
                      card_id: control.cardId,
                      requester_id: "user-1",
                      status: control.shipmentStatus,
                      tracking_number: control.trackingNumber,
                    },
                    error: null,
                  })
                : Promise.resolve({ data: null, error: null }),
          };
          return builder;
        },
      };
    }
    return { select: () => ({}) };
  });
  const db = {
    from: (table: string) => {
      control.fromCalls.push({ table, op: "read" });
      return fakeFrom(table);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      control.rpcCalls.push({ fn, args });
      if (control.fulfillError) {
        return Promise.resolve({ data: null, error: { message: `${control.fulfillError.code}\n${control.fulfillError.message}` } });
      }
      return Promise.resolve({
        data: {
          id: "ship-1",
          card_id: control.cardId,
          requester_id: "user-1",
          status: args.p_status,
          tracking_number: args.p_tracking ?? control.trackingNumber,
        },
        error: null,
      });
    },
  };
  return { getSupabase: () => db };
});

const { app } = await import("../../index.js");

function patchStatus(id: string, body: Record<string, unknown>) {
  return app.request(`/api/shipments/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/shipments/:id/status — admin atomic fulfillment", () => {
  beforeEach(() => {
    control.shipmentExists = true;
    control.shipmentStatus = "packed";
    control.cardId = "card-1";
    control.trackingNumber = null;
    control.fulfillError = null;
    control.fromCalls = [];
    control.rpcCalls = [];
    control.auditCalls = [];
  });

  it("packed -> shipped (no tracking): 200 + panggil RPC admin_fulfill_shipment, tanpa direct write ke orders/cards", async () => {
    const res = await patchStatus("ship-1", { status: "shipped" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shipment: { id: string; status: string } };
    expect(body.shipment.id).toBe("ship-1");
    expect(body.shipment.status).toBe("shipped");
    // RPC dipanggil dengan arg benar
    expect(control.rpcCalls.length).toBe(1);
    expect(control.rpcCalls[0]).toMatchObject({
      fn: "admin_fulfill_shipment",
      args: { p_id: "ship-1", p_status: "shipped", p_tracking: null },
    });
    // Tidak ada update langsung ke orders/cards (refactor harus move semuanya ke RPC)
    const writes = control.fromCalls.filter((c) => c.table === "orders" || c.table === "cards");
    expect(writes).toEqual([]);
    // Audit tetap dicatat dengan action 'update' ke 'shipments'
    expect(control.auditCalls.length).toBe(1);
    const payload = control.auditCalls[0].args as unknown[];
    expect(payload[1]).toBe("update");
    expect(payload[2]).toBe("shipments");
    expect(payload[3]).toBe("ship-1");
    const summary = payload[4] as { status: string; trackingNumber: string | null };
    expect(summary.status).toBe("shipped");
    expect(summary.trackingNumber).toBeNull();
  });

  it("shipped -> delivered (with tracking): 200 + RPC dipanggil dengan tracking", async () => {
    control.shipmentStatus = "shipped";
    const res = await patchStatus("ship-1", { status: "delivered", trackingNumber: "JP123456" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shipment: { status: string; trackingNumber: string | null } };
    expect(body.shipment.status).toBe("delivered");
    expect(body.shipment.trackingNumber).toBe("JP123456");
    expect(control.rpcCalls.length).toBe(1);
    expect(control.rpcCalls[0]).toMatchObject({
      fn: "admin_fulfill_shipment",
      args: { p_id: "ship-1", p_status: "delivered", p_tracking: "JP123456" },
    });
    const writes = control.fromCalls.filter((c) => c.table === "orders" || c.table === "cards");
    expect(writes).toEqual([]);
  });

  it("shipment tidak ditemukan -> 404 (tanpa RPC, tanpa audit)", async () => {
    control.shipmentExists = false;
    const res = await patchStatus("ship-missing", { status: "shipped" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not found");
    expect(control.rpcCalls.length).toBe(0);
    expect(control.auditCalls.length).toBe(0);
  });

  it("transisi invalid (requested -> shipped tidak diizinkan jika map menolaknya) -> 409 (tanpa RPC, tanpa audit)", async () => {
    // SHIPMENT_TRANSITIONS mengizinkan requested -> shipped, jadi pilih transisi invalid
    // yang benar-benar ditolak: requested -> delivered (lompat shipped).
    control.shipmentStatus = "requested";
    const res = await patchStatus("ship-1", { status: "delivered" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Transisi tidak valid");
    expect(control.rpcCalls.length).toBe(0);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC INVALID_TRANSITION -> 409 (tanpa audit)", async () => {
    control.shipmentStatus = "shipped";
    // Request ke 'packed' adalah transisi invalid (shipped hanya boleh delivered).
    control.fulfillError = {
      code: "INVALID_TRANSITION",
      message: "Transisi tidak valid: shipped -> packed",
    };
    const res = await patchStatus("ship-1", { status: "packed" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Transisi tidak valid");
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC NOT_FOUND -> 404 (tanpa audit)", async () => {
    // Precheck shipmentExists=true, tapi RPC mungkin melihat row terhapus setelah lock.
    control.fulfillError = { code: "NOT_FOUND", message: "Tidak ditemukan" };
    const res = await patchStatus("ship-1", { status: "shipped" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Tidak ditemukan");
    expect(control.auditCalls.length).toBe(0);
  });

  it("non-admin -> 401 (tanpa RPC, tanpa audit)", async () => {
    control.fulfillError = { code: "_AUTH_FAIL_", message: "" };
    const res = await patchStatus("ship-1", { status: "shipped" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(control.rpcCalls.length).toBe(0);
    expect(control.auditCalls.length).toBe(0);
  });

  it("RPC PERMISSION_DENIED (audit 2026-08-23: in-body guard bocor) -> 400 + tanpa audit", async () => {
    // admin_fulfill_shipment ditambah is_service_role() guard (paritas dengan
    // release_seed_sale). EXECUTE grant service_role only + guard in-body =
    // defense-in-depth. Admin route via service_role → guard lewat.
    control.fulfillError = {
      code: "PERMISSION_DENIED",
      message: "Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role",
    };
    const res = await patchStatus("ship-1", { status: "shipped" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("service_role");
    expect(control.auditCalls.length).toBe(0);
  });
});
