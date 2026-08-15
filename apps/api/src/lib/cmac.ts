// AES-CMAC (RFC 4493) + NTAG 424 DNA SUN verification (NXP AN12196).
// Workers-safe: Web Crypto AES-CBC only (no nodejs_compat needed).

const ZERO_BLOCK = new Uint8Array(16);
// x^128 + x^7 + x^2 + x + 1 reduction constant — XOR into the LAST byte (LSB end)
const R128 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x87]);

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function shiftLeft(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length - 1; i++) out[i] = ((b[i] << 1) | (b[i + 1] >>> 7)) & 0xff;
  out[b.length - 1] = (b[b.length - 1] << 1) & 0xff;
  return out;
}

/** Encrypt one 16-byte block via Web Crypto AES-CBC (zero IV, PKCS7; first ct block = E_K(block)). */
async function aesEncryptBlock(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as unknown as BufferSource, "AES-CBC", false, ["encrypt"]);
  const iv = ZERO_BLOCK;
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, block as unknown as BufferSource);
  return new Uint8Array(ct.slice(0, 16));
}

/** AES-CMAC per RFC 4493. key & output are 16 bytes. */
export async function aesCmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (key.length !== 16) throw new Error("aesCmac: key must be 16 bytes");
  // Subkeys K1/K2 from L = AES_K(0^128) (RFC 4493 §2.3)
  const l = await aesEncryptBlock(key, ZERO_BLOCK);
  let k1 = shiftLeft(l);
  if (l[0] & 0x80) k1 = xorBytes(k1, R128);
  let k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2 = xorBytes(k2, R128);

  // Split into blocks; last block handled per RFC 4493 §2.3 (K1 for complete, K2 + 10..0 pad otherwise)
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < message.length; i += 16) blocks.push(message.slice(i, i + 16));

  const isComplete = message.length > 0 && message.length % 16 === 0;
  let last: Uint8Array<ArrayBufferLike>;
  if (isComplete) {
    last = xorBytes(blocks.pop() as Uint8Array, k1);
  } else {
    const partial = blocks.pop() ?? new Uint8Array(0); // empty message -> pad from scratch
    const padded = new Uint8Array(16);
    padded.set(partial);
    padded[partial.length] = 0x80;
    last = xorBytes(padded, k2);
  }

  let x: Uint8Array = ZERO_BLOCK;
  for (const block of blocks) {
    x = await aesEncryptBlock(key, xorBytes(x, block));
  }
  return aesEncryptBlock(key, xorBytes(x, last));
}

/** Key diversification per dev-strategy 18_nfc_decision N5: AppKey = AES-CMAC(MasterKey, UID[7]). */
export async function deriveAppKey(master: Uint8Array, uid: Uint8Array): Promise<Uint8Array> {
  if (uid.length !== 7) throw new Error("deriveAppKey: uid must be 7 bytes");
  return aesCmac(master, uid);
}

/** Constant-time comparison (no early exit). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface SunInput {
  uidHex: string; // 14 hex chars (7 bytes)
  ctrHex: string; // 6 hex chars (3 bytes, big-endian as displayed in URL)
  cmacHex: string; // 16 hex chars (8 bytes, SUN-mirrored truncated CMAC)
}

export type SunVerifyResult = { valid: true } | { valid: false; reason: "bad_format" | "bad_cmac" };

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify NTAG 424 DNA SUN message (AN12196): SV2 = 3C C3 00 01 00 80 || UID[7] || ReadCtr[3 LE],
 * zero-padded; SDMMAC = AES-CMAC( AES-CMAC(K, SV2), "" ) truncated to odd-index bytes (8).
 * K = AppKey diversified per-UID from the platform master key.
 */
export async function verifySun(input: SunInput, appKey: Uint8Array): Promise<SunVerifyResult> {
  const uid = hexToBytes(input.uidHex);
  const ctr = hexToBytes(input.ctrHex);
  const cmac = hexToBytes(input.cmacHex);
  if (!uid?.length || uid.length !== 7 || !ctr?.length || ctr.length !== 3 || !cmac?.length || cmac.length !== 8) {
    return { valid: false, reason: "bad_format" };
  }
  // URL counter is big-endian display; PICC data carries it little-endian
  const ctrLe = new Uint8Array([ctr[2], ctr[1], ctr[0]]);
  const sv2 = new Uint8Array(6 + 7 + 3);
  sv2.set([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], 0);
  sv2.set(uid, 6);
  sv2.set(ctrLe, 13);

  const c2 = await aesCmac(appKey, sv2);
  const mac = await aesCmac(c2, new Uint8Array(0));
  const expected = new Uint8Array(8);
  for (let i = 0; i < 8; i++) expected[i] = mac[i * 2 + 1];

  return timingSafeEqual(expected, cmac) ? { valid: true } : { valid: false, reason: "bad_cmac" };
}
