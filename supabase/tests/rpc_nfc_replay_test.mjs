// C.Verse — DB-level NFC anti-replay coverage (gap P1-3, N-series).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   NFC_MASTER_KEY="$(grep -E '^NFC_MASTER_KEY=' apps/api/.dev.vars | head -1 | cut -d= -f2- | tr -d '"\r')" \
//     node supabase/tests/rpc_nfc_replay_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Jangan pernah hardcode key — NFC_MASTER_KEY WAJIB lewat env (parse
// apps/api/.dev.vars di runner); tanpa key N1-N5 SKIP (exit 2) dan coverage
// dilaporkan PENDING, bukan false-green. N0/N0b selalu jalan (pakai RFC 4493
// public test vectors — bukan platform secret).
//
// FINDING (penting): TIDAK ADA RPC verify_tap di DB (04_rpc.sql). Enforcement
// anti-replay hidup sebagai ATOMIC conditional UPDATE yang di-issue API layer
// (apps/api/src/modules/nfc/routes.ts persistVerified L37-49 / persistTampered
// L51-79), sementara CMAC diverifikasi murni app-level di apps/api/src/lib/cmac.ts
// (verifySun, AN12196 SV2 layout). Jadi test ini:
//   - meng-mirror aesCmac/deriveAppKey/verifySun byte-for-byte pakai node:crypto
//     (N0 divalidasi dengan official RFC 4493 test vectors, N0b = self-check
//     pipeline SUN), dan
//   - mengeksekusi SHAPE UPDATE yang persis sama dengan yang dikirim API ke DB,
//     lalu read-back counter/status dari row untuk tiap assertion (N1-N5).
// Tamper app-flow end-to-end sudah unit-covered (nfc_tamper_atomic.test.ts);
// yang dicover baru di sini adalah DB-level guard-nya (N5).
import crypto from "node:crypto";
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// ── node:crypto mirror of apps/api/src/lib/cmac.ts ─────────────────────────
// Mirror of cmac.ts aesEncryptBlock (L22-27): AES-128-CBC zero IV; first ct
// block = E_K(block); PKCS7 tail (17th block) discarded.
const ZERO_BLOCK = Buffer.alloc(16, 0);
function aesEncryptBlock(key, block) {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, ZERO_BLOCK);
  return Buffer.concat([cipher.update(block), cipher.final()]).subarray(0, 16);
}
// Mirror of cmac.ts aesCmac (L30-60): RFC 4493 subkeys K1/K2 from L = AES_K(0^128),
// R128 reduction XOR into last byte, K1 for complete last block / K2 + 0x80 pad otherwise.
const R128 = Buffer.alloc(16, 0);
R128[15] = 0x87;
function xorBytes(a, b) {
  return Buffer.from(a.map((v, i) => v ^ b[i]));
}
function shiftLeft(b) {
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length - 1; i++) out[i] = ((b[i] << 1) | (b[i + 1] >>> 7)) & 0xff;
  out[b.length - 1] = (b[b.length - 1] << 1) & 0xff;
  return out;
}
function aesCmac(key, message) {
  if (key.length !== 16) throw new Error("aesCmac: key must be 16 bytes");
  const l = aesEncryptBlock(key, ZERO_BLOCK);
  let k1 = shiftLeft(l);
  if (l[0] & 0x80) k1 = xorBytes(k1, R128);
  let k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2 = xorBytes(k2, R128);
  const blocks = [];
  for (let i = 0; i < message.length; i += 16) blocks.push(message.subarray(i, i + 16));
  const isComplete = message.length > 0 && message.length % 16 === 0;
  let last;
  if (isComplete) {
    last = xorBytes(blocks.pop(), k1);
  } else {
    const partial = blocks.pop() ?? Buffer.alloc(0);
    const padded = Buffer.alloc(16, 0);
    padded.set(partial);
    padded[partial.length] = 0x80;
    last = xorBytes(padded, k2);
  }
  let x = ZERO_BLOCK;
  for (const block of blocks) x = aesEncryptBlock(key, xorBytes(x, block));
  return aesEncryptBlock(key, xorBytes(x, last));
}
// Mirror of cmac.ts deriveAppKey (L63-66): AppKey = AES-CMAC(MasterKey, UID[7]).
function deriveAppKey(master, uid) {
  if (uid.length !== 7) throw new Error("deriveAppKey: uid must be 7 bytes");
  return aesCmac(master, uid);
}
function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, "hex");
}
// Mirror of cmac.ts verifySun (L97-117): SV2 = 3C C3 00 01 00 80 || UID[7] ||
// ReadCtr[3 LE]; SDMMAC = AES-CMAC(AES-CMAC(K, SV2), "") truncated to odd-index
// bytes (8). URL counter is big-endian display; PICC data carries it LE.
function sdmmac(appKey, uidHex, ctrHex) {
  const uid = hexToBytes(uidHex);
  const ctr = hexToBytes(ctrHex);
  if (uid?.length !== 7 || ctr?.length !== 3) throw new Error("sdmmac: bad input format");
  const ctrLe = Buffer.from([ctr[2], ctr[1], ctr[0]]);
  const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uid, ctrLe]);
  const c2 = aesCmac(appKey, sv2);
  const mac = aesCmac(c2, Buffer.alloc(0));
  const expected = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) expected[i] = mac[i * 2 + 1];
  return expected;
}
function verifySunMirror(appKey, uidHex, ctrHex, cmacHex) {
  const cmac = hexToBytes(cmacHex);
  if (cmac?.length !== 8) return { valid: false, reason: "bad_format" };
  const expected = sdmmac(appKey, uidHex, ctrHex);
  return expected.equals(cmac) ? { valid: true } : { valid: false, reason: "bad_cmac" };
}

// ── DB-side mirror of nfc/routes.ts atomic guards (service_role client) ────
// Mirror of persistVerified (routes.ts L37-49): UPDATE ... WHERE last_ctr < ctr
// AND verify_status <> 'tamper_detected' — rowCount 0/1 ≡ data != null di API.
async function persistVerified(db, cardId, ctr) {
  const { rowCount } = await db.query(
    "update public.cards set verify_status = 'verified', last_ctr = $2 where id = $1 and last_ctr < $2 and verify_status <> 'tamper_detected' returning id",
    [cardId, ctr],
  );
  return rowCount;
}
// Mirror of persistTampered (routes.ts L51-79): with ctr — counter advance + flag
// flip in ONE UPDATE guarded by last_ctr < ctr; ctr null — flag-only flip.
async function persistTampered(db, cardId, ctr) {
  if (ctr == null) {
    const { rowCount } = await db.query("update public.cards set verify_status = 'tamper_detected' where id = $1 returning id", [cardId]);
    return rowCount;
  }
  const { rowCount } = await db.query(
    "update public.cards set verify_status = 'tamper_detected', last_ctr = $2 where id = $1 and last_ctr < $2 returning id",
    [cardId, ctr],
  );
  return rowCount;
}
async function readCard(db, cardId) {
  const { rows } = await db.query("select verify_status::text as verify_status, last_ctr, nfc_uid from public.cards where id = $1", [
    cardId,
  ]);
  return rows[0];
}

// Mirror of verifyTap decision flow (routes.ts L112-184): tamper gate -> CMAC
// check -> tamperFlag branch -> counter gate -> atomic persistVerified.
function appVerifyTap(card, { uidHex, ctrHex, cmacHex, tamperFlag = false }) {
  if (card.verify_status === "tamper_detected") return { status: "tamper_detected", update: null };
  const appKey = deriveAppKey(MASTER_KEY, hexToBytes(card.nfc_uid));
  const sun = verifySunMirror(appKey, uidHex, ctrHex, cmacHex);
  if (!sun.valid) return { status: "unknown", reason: sun.reason, update: null };
  const ctrNum = Number.parseInt(ctrHex, 16);
  if (tamperFlag) {
    return { status: "tamper_detected", update: { kind: "tamper", ctr: ctrNum > card.last_ctr ? ctrNum : null } };
  }
  if (ctrNum <= card.last_ctr) return { status: "unknown", reason: "counter_replay", update: null };
  return { status: "verified", update: { kind: "verify", ctr: ctrNum } };
}

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}
function skip(id, detail) {
  results.push({ id, pass: false, skipped: true });
  console.log(`${id} SKIP (${detail})`);
}

// RFC 4493 Appendix B public test vector key (bukan platform secret).
const RFC4493_KEY = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");

// ── N0: RFC 4493 official test vectors — proves the node:crypto aesCmac mirror
// is byte-for-byte the same algorithm cmac.ts implements. Key-independent. ──
{
  const vectors = [
    ["", "bb1d6929e95937287fa37d129b756746"], // Ex.1: empty -> K2 pad
    ["6bc1bee22e409f96e93d7e117393172a", "070a16b46b4d4144f79bdd9dd04a287c"], // Ex.2: 16B complete -> K1
    ["6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411", "dfa66747de9ae63030ca32611497c827"], // Ex.3: 40B partial -> K2 pad
    [
      "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
      "51f0bebf7e3b9d92fc49741779363cfe",
    ], // Ex.4: 64B complete multi-block -> K1
  ];
  const bad = vectors.filter(([m, exp]) => aesCmac(RFC4493_KEY, Buffer.from(m, "hex")).toString("hex") !== exp);
  report("N0", bad.length === 0, bad.length === 0 ? "4/4 RFC 4493 vectors match" : `vector mismatch: ${bad.map((b) => b[1]).join(",")}`);
}

// ── N0b: AN12196 SUN pipeline self-check (mirror of verifySun) — SV2 layout,
// little-endian counter, odd-index SDMMAC truncation, tampered-CMAC rejection.
// Uses the public RFC key as AppKey — no platform secret involved. ──
{
  const uidHex = crypto.randomBytes(7).toString("hex");
  const ctrHex = "000065";
  const good = sdmmac(RFC4493_KEY, uidHex, ctrHex);
  const flipped = Buffer.from(good);
  flipped[3] ^= 0x01;
  const accepted = verifySunMirror(RFC4493_KEY, uidHex, ctrHex, good.toString("hex"));
  const rejected = verifySunMirror(RFC4493_KEY, uidHex, ctrHex, flipped.toString("hex"));
  report(
    "N0b",
    accepted.valid === true && rejected.valid === false && rejected.reason === "bad_cmac",
    `valid_accepted=${accepted.valid} flipped={valid:${rejected.valid},reason:${rejected.reason}}`,
  );
}

// ── Key gate: N1-N5 butuh NFC_MASTER_KEY platform (env) — never fabricate. ──
const MASTER_KEY_HEX = process.env.NFC_MASTER_KEY;
const hasMasterKey = typeof MASTER_KEY_HEX === "string" && /^[0-9a-fA-F]{32}$/.test(MASTER_KEY_HEX);
if (!hasMasterKey) {
  for (const id of ["N1", "N2", "N3", "N4", "N5a", "N5b", "N5c"]) {
    skip(id, "NFC_MASTER_KEY missing/invalid — set via env (parse apps/api/.dev.vars di runner); coverage PENDING");
  }
  console.log("\nRESULT: PENDING — NFC_MASTER_KEY tidak terkonfigurasi di bench ini; N0/N0b tetap tervalidasi.");
  process.exit(2);
}
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, "hex");

const db = new Client({ connectionString: url });
await db.connect();
await db.query("set role service_role"); // bypass RLS + cards_buyout_guard (is_service_role)

// ── Fixtures (self-contained, random UUIDs — aman terhadap lane lain) ──────
const stamp = Date.now().toString(36);
const userId = crypto.randomUUID();
const dropId = `nfc-replay-drop-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
const cardA = `nfc-replay-a-${stamp}`;
const cardB = `nfc-replay-b-${stamp}`;
const cardC = `nfc-replay-c-${stamp}`;
const uidHexA = crypto.randomBytes(7).toString("hex"); // 14 hex chars
const uidHexB = crypto.randomBytes(7).toString("hex");
const uidHexC = crypto.randomBytes(7).toString("hex");
const BASELINE = 100;

await db.query("begin");
await db.query("insert into public.users (id, email, display_name) values ($1, $2, $3)", [
  userId,
  `nfc-replay-${stamp}@test`,
  "NFC Replay Test",
]);
await db.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, creator_id, creator_name, sold_count)
   values ($1,'NFC Replay Drop','NFC Replay Series','narrative','/x.jpg',3,0,3,10,10,10,'live',$2,'Creator NFC',0)`,
  [dropId, userId],
);
// unit_number WAJIB unik per drop (unique (drop_id, unit_number)) — incremental 1..n.
for (const [unitNumber, [cardId, uidHex]] of [
  [cardA, uidHexA],
  [cardB, uidHexB],
  [cardC, uidHexC],
].entries()) {
  await db.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id,
       verify_status, location, nfc_configured, qc_status, last_ctr)
     values ($1, $2, $7, 'unsigned', 'sold', $3, $4, $5, 'registered', 'with_owner', true, 'passed', $6)`,
    [cardId, dropId, userId, uidHex, `sd-${cardId}`, BASELINE, unitNumber + 1],
  );
}

// ── N1: valid tap — valid CMAC + ctr = baseline+1 → verified, counter persists. ──
{
  const ctrHex = (BASELINE + 1).toString(16).padStart(6, "0");
  const cmacHex = sdmmac(deriveAppKey(MASTER_KEY, hexToBytes(uidHexA)), uidHexA, ctrHex).toString("hex");
  const card = await readCard(db, cardA);
  const decision = appVerifyTap(card, { uidHex: uidHexA, ctrHex, cmacHex });
  const affected = decision.update ? await persistVerified(db, cardA, decision.update.ctr) : 0;
  const after = await readCard(db, cardA);
  report(
    "N1",
    decision.status === "verified" && affected === 1 && after.verify_status === "verified" && after.last_ctr === BASELINE + 1,
    `status=${decision.status} rows=${affected} db={${after.verify_status},last_ctr=${after.last_ctr}} expected={verified,${BASELINE + 1}}`,
  );
}

// ── N2: REPLAY of the exact N1 payload (same ctr, same CMAC) → rejected by the
// atomic guard, counter UNCHANGED. ──
{
  const ctrHex = (BASELINE + 1).toString(16).padStart(6, "0");
  const cmacHex = sdmmac(deriveAppKey(MASTER_KEY, hexToBytes(uidHexA)), uidHexA, ctrHex).toString("hex");
  const card = await readCard(db, cardA);
  const decision = appVerifyTap(card, { uidHex: uidHexA, ctrHex, cmacHex });
  const affected = await persistVerified(db, cardA, BASELINE + 1); // issue the UPDATE anyway — DB must refuse
  const after = await readCard(db, cardA);
  report(
    "N2",
    decision.status === "unknown" && decision.reason === "counter_replay" && affected === 0 && after.last_ctr === BASELINE + 1,
    `reason=${decision.reason} rows=${affected} db.last_ctr=${after.last_ctr} (unchanged=${BASELINE + 1})`,
  );
}

// ── N3: backward counter (ctr = baseline ≤ last_ctr) with a VALID CMAC for that
// counter → rejected by counter gate, NOT by CMAC; counter unchanged. ──
{
  const ctrHex = BASELINE.toString(16).padStart(6, "0");
  const appKey = deriveAppKey(MASTER_KEY, hexToBytes(uidHexA));
  const cmacHex = sdmmac(appKey, uidHexA, ctrHex).toString("hex");
  const cmacIsValid = verifySunMirror(appKey, uidHexA, ctrHex, cmacHex).valid; // must be true — isolates the counter gate
  const card = await readCard(db, cardA);
  const decision = appVerifyTap(card, { uidHex: uidHexA, ctrHex, cmacHex });
  const affected = await persistVerified(db, cardA, BASELINE);
  const after = await readCard(db, cardA);
  report(
    "N3",
    cmacIsValid &&
      decision.status === "unknown" &&
      decision.reason === "counter_replay" &&
      affected === 0 &&
      after.last_ctr === BASELINE + 1,
    `cmac_valid=${cmacIsValid} reason=${decision.reason} rows=${affected} db.last_ctr=${after.last_ctr} (unchanged=${BASELINE + 1})`,
  );
}

// ── N4: forward counter with INVALID CMAC (one flipped byte) → app rejects
// before any DB write (counter unchanged); contrast: same counter with VALID
// CMAC IS accepted — proves CMAC is checked, not just the counter. ──
{
  const ctrHex = (BASELINE + 2).toString(16).padStart(6, "0");
  const appKey = deriveAppKey(MASTER_KEY, hexToBytes(uidHexB));
  const goodCmac = sdmmac(appKey, uidHexB, ctrHex);
  const badCmac = Buffer.from(goodCmac);
  badCmac[3] ^= 0x01; // flip one byte
  const badDecision = appVerifyTap(await readCard(db, cardB), { uidHex: uidHexB, ctrHex, cmacHex: badCmac.toString("hex") });
  const untouched = await readCard(db, cardB); // no UPDATE issued — app stopped at CMAC gate
  const goodDecision = appVerifyTap(await readCard(db, cardB), { uidHex: uidHexB, ctrHex, cmacHex: goodCmac.toString("hex") });
  const affected = goodDecision.update ? await persistVerified(db, cardB, goodDecision.update.ctr) : 0;
  const after = await readCard(db, cardB);
  report(
    "N4",
    badDecision.status === "unknown" &&
      badDecision.reason === "bad_cmac" &&
      badDecision.update === null &&
      untouched.last_ctr === BASELINE &&
      untouched.verify_status === "registered" &&
      affected === 1 &&
      after.last_ctr === BASELINE + 2 &&
      after.verify_status === "verified",
    `bad: reason=${badDecision.reason} db_before={${untouched.verify_status},${untouched.last_ctr}}; good contrast: rows=${affected} db_after={${after.verify_status},${after.last_ctr}}`,
  );
}

// ── N5: tamper path (DB-level shape of persistTampered; app flow end-to-end is
// unit-covered in nfc_tamper_atomic.test.ts). ──
// N5a: tamper flag + forward counter → one atomic UPDATE: flag set AND counter advanced.
{
  const ctrHex = (BASELINE + 3).toString(16).padStart(6, "0");
  const cmacHex = sdmmac(deriveAppKey(MASTER_KEY, hexToBytes(uidHexB)), uidHexB, ctrHex).toString("hex");
  const decision = appVerifyTap(await readCard(db, cardB), { uidHex: uidHexB, ctrHex, cmacHex, tamperFlag: true });
  const affected = decision.update ? await persistTampered(db, cardB, decision.update.ctr) : 0;
  const after = await readCard(db, cardB);
  report(
    "N5a",
    decision.status === "tamper_detected" && affected === 1 && after.verify_status === "tamper_detected" && after.last_ctr === BASELINE + 3,
    `status=${decision.status} rows=${affected} db={${after.verify_status},last_ctr=${after.last_ctr}} expected={tamper_detected,${BASELINE + 3}}`,
  );
}
// N5b: tamper permanence — valid forward tap on tamper_detected card: app gate
// rejects AND the verified-shaped UPDATE (verify_status <> 'tamper_detected')
// must match 0 rows; counter unchanged.
{
  const ctrHex = (BASELINE + 4).toString(16).padStart(6, "0");
  const cmacHex = sdmmac(deriveAppKey(MASTER_KEY, hexToBytes(uidHexB)), uidHexB, ctrHex).toString("hex");
  const decision = appVerifyTap(await readCard(db, cardB), { uidHex: uidHexB, ctrHex, cmacHex });
  const affected = await persistVerified(db, cardB, BASELINE + 4); // guard must refuse tamper_detected
  const after = await readCard(db, cardB);
  report(
    "N5b",
    decision.status === "tamper_detected" && affected === 0 && after.verify_status === "tamper_detected" && after.last_ctr === BASELINE + 3,
    `status=${decision.status} rows=${affected} db={${after.verify_status},last_ctr=${after.last_ctr}} (unchanged ${BASELINE + 3})`,
  );
}
// N5c: stale tamper SUN (ctr cannot advance) → flag-only flip, counter unchanged
// (persistTampered ctr=null branch, routes.ts L53-59).
{
  const before = await readCard(db, cardC);
  const affected = await persistTampered(db, cardC, null);
  const after = await readCard(db, cardC);
  report(
    "N5c",
    affected === 1 && after.verify_status === "tamper_detected" && after.last_ctr === BASELINE && before.last_ctr === BASELINE,
    `rows=${affected} db={${after.verify_status},last_ctr=${after.last_ctr}} (counter must stay ${BASELINE})`,
  );
}

// ── Cleanup (only our random rows; never db reset) ──────────────────────────
await db.query("delete from public.cards where drop_id = $1", [dropId]);
await db.query("delete from public.drops where id = $1", [dropId]);
await db.query("delete from public.users where id = $1", [userId]);
await db.query("commit");
await db.end();

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — NOT GREEN: ${failed.map((f) => f.id).join(",")}` : ""}`,
);
process.exit(failed.length ? 1 : 0);
