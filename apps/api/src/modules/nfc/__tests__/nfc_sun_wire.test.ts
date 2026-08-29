import { beforeEach, describe, expect, it, vi } from "vitest";
import { aesCmac, deriveAppKey } from "../../../lib/cmac.js";
import type { Card } from "../../../lib/store.js";

// Wire-up tests (audit 2026-08-29): the SUN tap params (?uid=&ctr=&c=) that iOS
// appends to the NDEF URL must actually reach the CMAC verifier via
// GET /cards/:id/3d; the QR/Web-NFC paths must persist "registered" guarded to
// unknown/registered; and the optional tamper flag `t` must flow through
// POST /verify-nfc with the same post-CMAC trust semantics as the SUN path.

const MASTER_HEX = "00112233445566778899aabbccddeeff";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

interface CallShape {
  table: string;
  patch: Record<string, unknown>;
  guards: Record<string, unknown>;
}

// Capture every Supabase write so we can assert on the exact UPDATE shape.
const control = vi.hoisted(() => ({
  card: null as Card | null,
  calls: [] as Array<{ table: string; patch: Record<string, unknown>; guards: Record<string, unknown> }>,
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

// PostgREST builder mock: chainable + thenable + records every (update, eq, lt, not, in)
// call site so we can assert guard shapes (persist* helpers use getSupabase directly).
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
    in: (col: string, val: unknown) => {
      state.guards[`${col}__in`] = val;
      return builder;
    },
    select: () => builder,
    maybeSingle: () => {
      control.calls.push(state);
      return Promise.resolve({ data: { id: "card-1" }, error: null });
    },
  };
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
}));

const { app } = await import("../../../index.js");

function bytes(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));
}

/** Recompute the SUN SDMMAC (AN12196) the verifier expects, so we can send a valid tap. */
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

function verifyNfc(body: Record<string, unknown>) {
  return app.request("/api/nfc/verify-nfc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function verifyCard3d(cardId: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return app.request(`/api/nfc/cards/${cardId}/3d?${qs}`, { method: "GET" });
}

describe("GET /api/nfc/cards/:id/3d — SUN params reach CMAC verification", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, string | undefined>).NFC_MASTER_KEY = MASTER_HEX;
    control.card = makeCard({});
    control.calls.length = 0;
  });

  it("issues 'verified' and persists the atomic counter advance when uid/ctr/c are forwarded", async () => {
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyCard3d("card-1", { uid: "04a1b2c3d4e580", ctr: "000005", c: cmac });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { verifyStatus: string }; verifiedBadge: string | null };
    expect(body.card.verifyStatus).toBe("verified");
    expect(body.verifiedBadge).toBe("Verified Card");

    const verifiedCalls = control.calls.filter((c) => c.patch.verify_status === "verified");
    expect(verifiedCalls).toHaveLength(1);
    expect(verifiedCalls[0].patch).toMatchObject({ verify_status: "verified", last_ctr: 5 });
    expect(verifiedCalls[0].guards).toMatchObject({ id: "card-1", last_ctr__lt: 5 });
  });

  it("bare visit (no SUN params) never writes and stays QR-grade", async () => {
    const res = await verifyCard3d("card-1", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { card: { verifyStatus: string } };
    expect(body.card.verifyStatus).toBe("registered");
    expect(control.calls).toHaveLength(0);
  });
});

describe("POST /api/nfc/verify-nfc — persistence + tamper flag", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, string | undefined>).NFC_MASTER_KEY = MASTER_HEX;
    control.card = makeCard({});
    control.calls.length = 0;
  });

  it("persists QR-grade 'registered' guarded to unknown/registered only", async () => {
    const res = await verifyNfc({ uid: "04a1b2c3d4e580" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("registered");

    const registeredCalls = control.calls.filter((c) => c.patch.verify_status === "registered");
    expect(registeredCalls).toHaveLength(1);
    expect(registeredCalls[0].guards).toMatchObject({ id: "card-1", verify_status__in: ["unknown", "registered"] });
  });

  it("honours tamper flag t='1' after CMAC validates (parity with the SUN path)", async () => {
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac, t: "1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("tamper_detected");

    const tamperCalls = control.calls.filter((c) => c.patch.verify_status === "tamper_detected");
    expect(tamperCalls).toHaveLength(1);
    expect(tamperCalls[0].patch).toMatchObject({ verify_status: "tamper_detected", last_ctr: 5 });
  });

  it("omitting t keeps the normal verified path", async () => {
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac });
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("verified");
  });
});
