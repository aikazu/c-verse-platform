import { beforeEach, describe, expect, it, vi } from "vitest";
import { aesCmac, deriveAppKey } from "../../../lib/cmac.js";
import type { Card } from "../../../lib/store.js";

const MASTER_HEX = "00112233445566778899aabbccddeeff";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

interface CallShape {
  table: string;
  patch: Record<string, unknown>;
  guards: Record<string, unknown>;
}

// Capture every Supabase call so we can assert on the exact query shape.
const control = vi.hoisted(() => ({
  card: null as Card | null,
  calls: [] as CallShape[],
}));

vi.mock("../reads.js", () => ({
  getCardByNfcUid: () => Promise.resolve(control.card),
  getCardByNfcShortId: () => Promise.resolve(control.card),
  listOwnershipByCard: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/drops.js", () => ({
  getCardByIdOrNfc: () => Promise.resolve(control.card),
  getDropById: () => Promise.resolve(null),
}));
vi.mock("../../../lib/reads/users.js", () => ({
  getUserById: () => Promise.resolve(null),
  listUsersByIds: () => Promise.resolve([]),
}));
vi.mock("../../../lib/reads/bids.js", () => ({ listBids: () => Promise.resolve([]) }));
vi.mock("../../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

// PostgREST builder mock: chainable + thenable + records every (update, eq, lt, not)
// call site so we can assert the atomic UPDATE shape.
function makeBuilder(table: string) {
  const state: CallShape = { table, patch: {}, guards: {} };
  const builder: Record<string, unknown> = {
    update: (patch: Record<string, unknown>) => {
      state.patch = patch;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      state.guards[col] = val;
      return builder;
    },
    lt: (col: string, val: unknown) => {
      state.guards[`${col}__lt`] = val;
      return builder;
    },
    not: (col: string, op: string, val: unknown) => {
      state.guards[`${col}__${op}`] = val;
      return builder;
    },
    in: () => builder,
    select: () => builder,
    maybeSingle: () => {
      control.calls.push(state);
      return Promise.resolve({ data: { id: "card-1" }, error: null });
    },
  };
  // PostgREST builders are thenable so `await db.from(...).update(...).eq(...)` resolves
  // to { data, error } for write/update paths (see nfc.ts:58 — no maybeSingle).
  // biome-ignore lint/suspicious/noThenProperty: test mock must mirror PostgREST thenable builder
  builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
    control.calls.push(state);
    resolve({ data: { id: "card-1" }, error: null });
  };
  return builder;
}

vi.mock("../../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: (table: string) => makeBuilder(table),
  }),
  _resetSupabaseCache: () => undefined,
}));

const { app } = await import("../../../index.js");

function bytes(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));
}

async function validCmacHex(masterHex: string, uidHex: string, ctrHex: string): Promise<string> {
  const appKey = await deriveAppKey(bytes(masterHex), bytes(uidHex));
  const ctr = bytes(ctrHex);
  const ctrLe = new Uint8Array([ctr[2], ctr[1], ctr[0]]);
  const sv2 = new Uint8Array(16);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], 0);
  sv2.set(bytes(uidHex), 6);
  sv2.set(ctrLe, 13);
  const mac = await aesCmac(await aesCmac(appKey, sv2), new Uint8Array(0));
  let hex = "";
  for (let i = 0; i < 8; i++) hex += mac[i * 2 + 1].toString(16).padStart(2, "0");
  return hex;
}

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: "card-1",
    dropId: "drop-1",
    unitNumber: 1,
    variant: "unsigned",
    status: "owned",
    location: "collector",
    buyoutPriceCcoin: null,
    nfcConfigured: true,
    qcStatus: "passed",
    ownerId: "owner-1",
    nfcUid: "04a1b2c3d4e580",
    nfcShortId: "drop-001",
    verifyStatus: "unknown",
    lastCtr: 0,
    ...overrides,
  } as unknown as Card;
}

function verifyCard3d(cardId: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return app.request(`/api/nfc/cards/${cardId}/3d?${qs}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
}

describe("NFC tamper persistence is atomic (M3 audit 2026-08-24)", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, string | undefined>).NFC_MASTER_KEY = MASTER_HEX;
    control.card = makeCard({});
    control.calls.length = 0;
  });

  it("tamp dengan counter yang advance: counter + flag di-apply dalam satu UPDATE berguard last_ctr<ctr", async () => {
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyCard3d("card-1", { uid: "04a1b2c3d4e580", ctr: "000005", c: cmac, t: "1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { verifyStatus: string } };
    expect(body.card.verifyStatus).toBe("tamper_detected");

    // Single UPDATE untuk tamper — counter + flag digabung, guarded last_ctr < ctr.
    const tamperCalls = control.calls.filter(
      (c) => c.table === "cards" && "verify_status" in c.patch && c.patch.verify_status === "tamper_detected",
    );
    expect(tamperCalls).toHaveLength(1);
    expect(tamperCalls[0].patch).toMatchObject({ verify_status: "tamper_detected", last_ctr: 5 });
    expect(tamperCalls[0].guards).toMatchObject({ id: "card-1", last_ctr__lt: 5 });
  });
});
