import { beforeEach, describe, expect, it, vi } from "vitest";

// nfc_uid lookup hardening (lane B, audit 2026-08-31): ?uid= is unauthenticated
// input — % / _ wildcards must never enable prefix enumeration, and the lookup
// must hit the unique b-tree index (DB stores uppercase hex, see seeds/*.sql).

const control = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  row: null as Record<string, unknown> | null,
}));

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => {
    const q: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        control.calls.push({ method, args });
        return q;
      };
    for (const m of ["select", "eq", "ilike", "in", "or", "order", "limit"]) q[m] = record(m);
    const terminal = () => Promise.resolve({ data: control.row, error: null });
    q.maybeSingle = terminal;
    // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder must be awaitable
    q.then = (resolve: (v: { data: Record<string, unknown> | null; error: null }) => unknown) =>
      resolve({ data: control.row, error: null });
    return {
      from: (table: string) => {
        control.calls.push({ method: "from", args: [table] });
        return q;
      },
    };
  },
}));

const { getCardByNfcUid } = await import("../reads.js");

describe("getCardByNfcUid input hardening", () => {
  beforeEach(() => {
    control.calls = [];
    control.row = null;
  });

  it("rejects wildcard payloads pre-query — no ilike, no query executed, null result", async () => {
    control.row = { id: "card-1" };
    const card = await getCardByNfcUid("04%AB");
    expect(card).toBeNull();
    expect(control.calls.some((c) => c.method === "from")).toBe(false);
    expect(control.calls.some((c) => c.method === "ilike")).toBe(false);
  });

  it("rejects non-hex and over-length uids pre-query", async () => {
    expect(await getCardByNfcUid("NOT_HEX_ZZ")).toBeNull();
    expect(await getCardByNfcUid("a".repeat(15))).toBeNull();
    expect(await getCardByNfcUid("")).toBeNull();
    expect(control.calls.some((c) => c.method === "from")).toBe(false);
  });

  it("performs an exact eq lookup on the uppercased uid (never ilike)", async () => {
    control.row = { id: "card-1", drop_id: "drop-1", nfc_uid: "04A1B2C3D4E580" };
    const card = await getCardByNfcUid("04a1b2c3d4e580");
    expect(card?.id).toBe("card-1");
    expect(control.calls.some((c) => c.method === "ilike")).toBe(false);
    const eqs = control.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["nfc_uid", "04A1B2C3D4E580"]);
  });

  it("returns null for a well-formed uid that is not registered (not-found path)", async () => {
    const card = await getCardByNfcUid("04FFFFFFFFFFFF");
    expect(card).toBeNull();
  });
});
