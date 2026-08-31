import { beforeEach, describe, expect, it, vi } from "vitest";

// Filter-injection tests for lib/reads/drops.ts (lane B, audit 2026-08-31).
// Mocks lib/supabase.js and captures the PostgREST query-builder calls so we can
// assert the constructed or()/eq() arguments — the DB is never touched.

const control = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  row: null as Record<string, unknown> | null,
}));

vi.mock("../supabase.js", () => ({
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

const { getCardByIdOrNfc, listDrops } = await import("../reads/drops.js");

function orCalls(): string[] {
  return control.calls.filter((c) => c.method === "or").map((c) => c.args[0] as string);
}

describe("listDrops search sanitization", () => {
  beforeEach(() => {
    control.calls = [];
    control.row = null;
  });

  it("cannot inject extra or() conditions via a comma in ?search=", async () => {
    await listDrops({ search: "x,status.eq.draft" });
    const ors = orCalls();
    expect(ors.length).toBe(1);
    // exactly two conditions remain (title + series) — no user-controlled third clause
    expect(ors[0].split(",").length).toBe(2);
    expect(ors[0].startsWith("title.ilike.%")).toBe(true);
    expect(ors[0].endsWith("%")).toBe(true);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    await listDrops({ search: "50%_off" });
    const ors = orCalls();
    expect(ors.length).toBe(1);
    expect(ors[0]).toContain("50\\%\\_off");
  });

  it("skips the search clause when the term is only filter syntax or whitespace", async () => {
    await listDrops({ search: " , ( ) " });
    expect(orCalls().length).toBe(0);
  });

  it("caps an overlong search term before interpolation", async () => {
    await listDrops({ search: "a".repeat(150) });
    const ors = orCalls();
    expect(ors.length).toBe(1);
    expect(ors[0].length).toBeLessThan(300);
  });
});

describe("getCardByIdOrNfc injection guard", () => {
  beforeEach(() => {
    control.calls = [];
    control.row = { id: "card-1", drop_id: "drop-1" };
  });

  it("returns null without executing the or() template for a filter-syntax payload", async () => {
    const card = await getCardByIdOrNfc("bad,or(nfc_short_id.eq.x");
    expect(card).toBeNull();
    expect(control.calls.some((c) => c.method === "from")).toBe(false);
    expect(orCalls().length).toBe(0);
  });

  it("still resolves legitimate ids through the or(id.eq, nfc_short_id.eq) template", async () => {
    const card = await getCardByIdOrNfc("card-1");
    expect(card?.id).toBe("card-1");
    const ors = orCalls();
    expect(ors).toEqual(["id.eq.card-1,nfc_short_id.eq.card-1"]);
  });
});
