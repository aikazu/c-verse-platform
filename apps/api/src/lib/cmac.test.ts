import { describe, expect, it } from "vitest";
import { aesCmac, deriveAppKey, timingSafeEqual, verifySun } from "./cmac";

const hex = (s: string): Uint8Array => new Uint8Array((s.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)));
const K = hex("2b7e151628aed2a6abf7158809cf4f3c"); // RFC 4493 test key

// Matriks wajib docs/12 §4 + docs/15 §3.2.

describe("aesCmac (RFC 4493 test vectors)", () => {
  it("empty message", async () => {
    const t = await aesCmac(K, new Uint8Array(0));
    expect(Buffer.from(t).toString("hex")).toBe("bb1d6929e95937287fa37d129b756746");
  });

  it("16-byte message", async () => {
    const t = await aesCmac(K, hex("6bc1bee22e409f96e93d7e117393172a"));
    expect(Buffer.from(t).toString("hex")).toBe("070a16b46b4d4144f79bdd9dd04a287c");
  });

  it("40-byte message", async () => {
    const t = await aesCmac(K, hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411"));
    expect(Buffer.from(t).toString("hex")).toBe("dfa66747de9ae63030ca32611497c827");
  });

  it("64-byte message", async () => {
    const t = await aesCmac(
      K,
      hex(
        "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
      ),
    );
    expect(Buffer.from(t).toString("hex")).toBe("51f0bebf7e3b9d92fc49741779363cfe");
  });

  it("rejects non-16-byte key", async () => {
    await expect(aesCmac(new Uint8Array(8), new Uint8Array())).rejects.toThrow();
  });
});

describe("verifySun (AN12196 SUN, plain uid/ctr/cmac)", () => {
  // AN12196 sample (sdm-backend test_sun1): uid 04de5f1eacc040, read_ctr 61, zero key -> 94EED9EE65337086
  const zeroKey = new Uint8Array(16);
  const uid = "04de5f1eacc040";

  it("accepts the official AN12196 sample vector", async () => {
    const res = await verifySun({ uidHex: uid, ctrHex: "00003d", cmacHex: "94eed9ee65337086" }, zeroKey);
    expect(res).toEqual({ valid: true });
  });

  it("rejects cmac with 1 byte flipped", async () => {
    const res = await verifySun({ uidHex: uid, ctrHex: "00003d", cmacHex: "95eed9ee65337086" }, zeroKey);
    expect(res).toEqual({ valid: false, reason: "bad_cmac" });
  });

  it("rejects wrong counter (ctr mismatch changes CMAC)", async () => {
    const res = await verifySun({ uidHex: uid, ctrHex: "00003e", cmacHex: "94eed9ee65337086" }, zeroKey);
    expect(res).toEqual({ valid: false, reason: "bad_cmac" });
  });

  it("bad_format on malformed inputs", async () => {
    expect(await verifySun({ uidHex: "04de5f", ctrHex: "00003d", cmacHex: "94eed9ee65337086" }, zeroKey)).toEqual({
      valid: false,
      reason: "bad_format",
    });
    expect(await verifySun({ uidHex: uid, ctrHex: "xyz", cmacHex: "94eed9ee65337086" }, zeroKey)).toEqual({
      valid: false,
      reason: "bad_format",
    });
    expect(await verifySun({ uidHex: uid, ctrHex: "00003d", cmacHex: "94eed9ee6533708" }, zeroKey)).toEqual({
      valid: false,
      reason: "bad_format",
    });
  });
});

describe("deriveAppKey (N5 key diversification)", () => {
  it("AppKey = AES-CMAC(master, uid[7]) — deterministic, differs per uid", async () => {
    const master = hex("000102030405060708090a0b0c0d0e0f");
    const uidA = hex("04de5f1eacc040");
    const k1 = await deriveAppKey(master, uidA);
    const k2 = await deriveAppKey(master, hex("04de5f1eacc041"));
    expect(k1.length).toBe(16);
    expect(Buffer.from(k1).toString("hex")).toBe(Buffer.from(await deriveAppKey(master, uidA)).toString("hex"));
    expect(timingSafeEqual(k1, k2)).toBe(false);
  });

  it("rejects uid that is not 7 bytes", async () => {
    await expect(deriveAppKey(new Uint8Array(16), new Uint8Array(4))).rejects.toThrow();
  });
});

describe("timingSafeEqual", () => {
  it("constant-time compare semantics", () => {
    expect(timingSafeEqual(hex("aabb"), hex("aabb"))).toBe(true);
    expect(timingSafeEqual(hex("aabb"), hex("aabc"))).toBe(false);
    expect(timingSafeEqual(hex("aabb"), hex("aa"))).toBe(false);
  });
});
