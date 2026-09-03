import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  markedIds: [] as string[],
  markAll: false,
  limitArg: null as number | null,
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

vi.mock("../../../lib/supabase.js", () => {
  const fakeFrom = vi.fn((table: string) => {
    if (table !== "notifications") return { select: () => ({ eq: () => ({}) }) };
    return {
      select: () => {
        const q: Record<string, unknown> = {
          eq: (_col: string, _val: unknown) => q,
          is: (_col: string, _val: unknown) => q,
          order: () => q,
          limit: (n: number) => {
            control.limitArg = n;
            return Promise.resolve({ data: control.rows, error: null });
          },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const builder = {
          eq: (col: string, val: unknown) => {
            if (col === "id") control.markedIds.push(String(val));
            if (col === "user_id" && "read_at" in patch && !control.markAll) {
              // markAll mutation: capture user id
            }
            return builder;
          },
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: "n1" }, error: null }),
          }),
        };
        return builder;
      },
    };
  });
  return { getSupabase: () => ({ from: fakeFrom }), readDb: () => ({ from: fakeFrom }) };
});

const { app } = await import("../../../index.js");

function getList() {
  return app.request("/api/notifications", {
    headers: { Authorization: "Bearer t" },
  });
}

function getUnread() {
  return app.request("/api/notifications/unread-count", {
    headers: { Authorization: "Bearer t" },
  });
}

describe("GET /api/notifications (P0-3 inbox)", () => {
  beforeEach(() => {
    control.rows = [];
    control.markedIds = [];
    control.markAll = false;
    control.limitArg = null;
  });

  it("returns inbox list", async () => {
    control.rows = [
      {
        id: "n1",
        user_id: "u-1",
        channel: "in_app",
        template_key: "bid_outbid",
        payload: { cardId: "c1", newBid: 100 },
        status: "sent",
        created_at: new Date().toISOString(),
        read_at: null,
      },
    ];
    const res = await getList();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: Array<{ id: string }> };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].id).toBe("n1");
  });

  it("unread-count endpoint exists", async () => {
    const res = await getUnread();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unread: number };
    expect(typeof body.unread).toBe("number");
  });

  // Audit batch 2 F8: Number("abc") = NaN mengalir ke .limit(NaN) → 500.
  it("?limit=abc → 200 dengan default 30 (audit batch 2 F8)", async () => {
    const res = await app.request("/api/notifications?limit=abc", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    expect(control.limitArg).toBe(30);
  });

  it("?limit=250 di-clamp ke 100", async () => {
    const res = await app.request("/api/notifications?limit=250", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    expect(control.limitArg).toBe(100);
  });

  it("?limit=5 dipakai apa adanya", async () => {
    const res = await app.request("/api/notifications?limit=5", {
      headers: { Authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    expect(control.limitArg).toBe(5);
  });
});
