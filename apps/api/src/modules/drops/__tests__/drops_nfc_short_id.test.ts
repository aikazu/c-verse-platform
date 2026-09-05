import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({
  insertCall: null as Record<string, unknown> | null,
  postInsertCardCalls: [] as Array<Record<string, unknown>>,
  creator: { user_id: "00000000-0000-4000-8000-000000000003", status: "active" } as Record<string, unknown> | null,
  creatorUser: {
    id: "00000000-0000-4000-8000-000000000003",
    display_name: "Karina Aespa",
    role: "creator",
    flag_reason: null,
  } as Record<string, unknown> | null,
  // Simulasi DB constraint error (e2e bug 2026-08-29): insert drops/cards gagal.
  dropInsertError: null as { message: string } | null,
  cardsInsertError: null as { message: string } | null,
}));

vi.mock("../../../lib/auth.js", () => ({
  // Drop create admin-only (founder 2026-08-29) — mock sebagai admin.
  requireUser: () =>
    Promise.resolve({
      user: {
        id: "auth-user-1",
        email: "auth-user-1@cverse.id",
        displayName: "Auth User",
        role: "admin",
        username: "authuser",
        usernameIsAuto: false,
      },
      token: "t",
    }),
  adminGateError: () => ({ body: { error: "x" }, status: 401 }),
  clientIp: () => "127.0.0.1",
  tokenFingerprint: () => Promise.resolve("sha256:test"),
}));

vi.mock("../../../lib/reads/kyc.js", () => ({
  logAuditDb: () => Promise.resolve(),
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const db = {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: table === "creators" ? control.creator : control.creatorUser, error: null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          if (table === "drops") {
            control.insertCall = row;
            return Promise.resolve({ error: control.dropInsertError });
          }
          if (table === "cards") {
            control.postInsertCardCalls.push(row);
            return Promise.resolve({ error: control.cardsInsertError });
          }
          return Promise.resolve({ error: null });
        },
      };
      return db;
    },
  }),
  _resetSupabaseCache: () => undefined,
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  getDropById: () => Promise.resolve({ id: "drop-x", creatorId: "auth-user-1" } as never),
  listDrops: () => Promise.resolve([]),
  listCardsByDrop: () => Promise.resolve([]),
}));

const { app } = await import("../../../index.js");

function postDrop(body: Record<string, unknown>) {
  return app.request("/api/drops", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  title: "Drop Test",
  series: "Series Test",
  narrative: "A meaningful narrative for the test drop",
  totalUnits: 5,
  priceCcoin: 30,
  creatorId: "00000000-0000-4000-8000-000000000003",
};

function shortIdsFrom(batches: Array<Record<string, unknown>>): string[] {
  // insert("cards") menerima ARRAY baris — flatten dulu sebelum ambil kolomnya.
  return batches.flatMap((batch) => (Array.isArray(batch) ? batch : [batch]).map((row) => String(row.nfc_short_id)));
}

describe("POST /api/drops nfc_short_id unik (e2e bug 2026-08-29)", () => {
  beforeEach(() => {
    control.insertCall = null;
    control.postInsertCardCalls = [];
    control.creator = { user_id: "00000000-0000-4000-8000-000000000003", status: "active" };
    control.creatorUser = { id: "00000000-0000-4000-8000-000000000003", display_name: "Karina Aespa", role: "creator", flag_reason: null };
    control.dropInsertError = null;
    control.cardsInsertError = null;
  });

  it("dua drop beruntun menghasilkan kumpulan nfc_short_id yang TIDAK overlap (unique index cards_nfc_short_id_key)", async () => {
    const res1 = await postDrop(VALID_BODY);
    expect(res1.status).toBe(201);
    const firstBatch = [...control.postInsertCardCalls];

    const res2 = await postDrop(VALID_BODY);
    expect(res2.status).toBe(201);
    const secondBatch = control.postInsertCardCalls.slice(firstBatch.length);

    const first = new Set(shortIdsFrom(firstBatch));
    const second = shortIdsFrom(secondBatch);
    const overlap = second.filter((shortId) => first.has(shortId));
    expect(overlap).toEqual([]);
  });

  it("nfc_short_id unik di dalam satu drop dan berformat hex-acak + unit (bukan 'drop-00N' deterministik)", async () => {
    const res = await postDrop(VALID_BODY);
    expect(res.status).toBe(201);
    const ids = shortIdsFrom([...control.postInsertCardCalls]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortId of ids) {
      // 6 hex uppercase (crypto random, pola nfc_uid) + unit number.
      expect(shortId).toMatch(/^[0-9A-F]{6}-\d+$/);
    }
  });
});

describe("POST /api/drops error DB di-sanitize (e2e bug 2026-08-29)", () => {
  beforeEach(() => {
    control.insertCall = null;
    control.postInsertCardCalls = [];
    control.dropInsertError = null;
    control.cardsInsertError = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("duplicate key pada insert drops: body memakai sanitized shape, raw message TIDAK bocor ke klien (raw tetap di-log)", async () => {
    const rawMessage = 'duplicate key value violates unique constraint "drops_pkey"';
    control.dropInsertError = { message: rawMessage };
    const res = await postDrop(VALID_BODY);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("violates unique constraint");
    expect(body.error).not.toContain("drops_pkey");
    expect(body.error).toBe("Resource already exists");
    // Raw message tetap ter-log server-side untuk incident response.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[drops]"), expect.stringContaining("drops_pkey"));
    vi.mocked(console.error).mockRestore();
  });

  it("error insert cards juga di-sanitize dengan pola yang sama", async () => {
    const rawMessage = 'duplicate key value violates unique constraint "cards_nfc_short_id_key"';
    control.cardsInsertError = { message: rawMessage };
    const res = await postDrop(VALID_BODY);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Resource already exists");
    expect(body.error).not.toContain("cards_nfc_short_id_key");
    vi.mocked(console.error).mockRestore();
  });
});
