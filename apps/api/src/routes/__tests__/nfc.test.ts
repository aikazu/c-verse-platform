import { beforeEach, describe, expect, it, vi } from "vitest";
import { aesCmac, deriveAppKey } from "../../lib/cmac.js";
import type { Card } from "../../lib/store.js";

const MASTER_HEX = "00112233445566778899aabbccddeeff";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

const control = vi.hoisted(() => ({ card: null as unknown }));

vi.mock("../../lib/reads/nfc.js", () => ({
  getCardByNfcUid: () => Promise.resolve(control.card),
  getCardByNfcShortId: () => Promise.resolve(control.card),
  listOwnershipByCard: () => Promise.resolve([]),
}));
vi.mock("../../lib/reads/drops.js", () => ({
  getCardByIdOrNfc: () => Promise.resolve(control.card),
  getDropById: () => Promise.resolve(null),
}));
vi.mock("../../lib/reads/users.js", () => ({
  getUserById: () => Promise.resolve(null),
  listUsersByIds: () => Promise.resolve([]),
}));
vi.mock("../../lib/reads/bids.js", () => ({ listBids: () => Promise.resolve([]) }));
vi.mock("../../lib/reads/kyc.js", () => ({ logAuditDb: () => Promise.resolve() }));

// Chainable Supabase double — every builder method returns itself; terminal reads resolve ok.
function makeQuery() {
  const ok = { data: { id: "card-1" }, error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["update", "eq", "lt", "not", "in", "select"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(ok);
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder must be awaitable
  q.then = (resolve: (v: typeof ok) => unknown) => resolve(ok);
  return q;
}
vi.mock("../../lib/supabase.js", () => ({ getSupabase: () => ({ from: () => makeQuery() }) }));

const { app } = await import("../../index.js");

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

describe("POST /api/nfc/verify-nfc (verifyTap)", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, string | undefined>).NFC_MASTER_KEY = MASTER_HEX;
    control.card = makeCard({});
  });

  it("returns 404 for an unregistered UID", async () => {
    control.card = null;
    const res = await verifyNfc({ uid: "04a1b2c3d4e580" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("unknown");
  });

  it("returns QR-grade 'registered' when no CMAC fields are present", async () => {
    const res = await verifyNfc({ uid: "04a1b2c3d4e580" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("registered");
  });

  it("never issues 'verified' when the master key is not configured", async () => {
    (globalThis as unknown as Record<string, string | undefined>).NFC_MASTER_KEY = undefined;
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac: "0011223344556677" });
    const body = (await res.json()) as { verifyStatus: string; reason: string };
    expect(body.verifyStatus).toBe("unknown");
    expect(body.reason).toBe("nfc_master_key_missing");
  });

  it("rejects an invalid CMAC as 'unknown' (bad_cmac)", async () => {
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac: "0000000000000000" });
    const body = (await res.json()) as { verifyStatus: string; reason: string };
    expect(body.verifyStatus).toBe("unknown");
    expect(body.reason).toBe("bad_cmac");
  });

  it("issues 'verified' for a valid CMAC with an advancing counter", async () => {
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac });
    const body = (await res.json()) as { verifyStatus: string; verifiedBadge: string | null };
    expect(body.verifyStatus).toBe("verified");
    expect(body.verifiedBadge).toBe("Verified Card");
  });

  it("keeps a tamper-detected card tampered regardless of a valid CMAC", async () => {
    control.card = makeCard({ verifyStatus: "tamper_detected" });
    const cmac = await validCmacHex(MASTER_HEX, "04a1b2c3d4e580", "000005");
    const res = await verifyNfc({ uid: "04a1b2c3d4e580", counter: "000005", cmac });
    const body = (await res.json()) as { verifyStatus: string };
    expect(body.verifyStatus).toBe("tamper_detected");
  });
});
