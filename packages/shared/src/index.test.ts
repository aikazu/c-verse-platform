import { describe, expect, it } from "vitest";
import {
  calcLevel,
  calcSignedCount,
  calcUnsignedCount,
  ccoinToIdr,
  idrToCCoin,
  isCcoinInteger,
  splitSecondaryFeeCcoin,
  xpForNextLevel,
} from "./index";

// Matriks wajib docs/15 §3.1 — uang & stok tidak boleh regress.

describe("idrToCCoin (ceil, integer)", () => {
  it("ceils to next integer C-Coin", () => {
    expect(idrToCCoin(15_000)).toBe(2); // 1,5 C -> 2 C
    expect(idrToCCoin(10_000)).toBe(1);
    expect(idrToCCoin(10_001)).toBe(2);
    expect(idrToCCoin(25_000)).toBe(3);
  });

  it("guards invalid input (negative / non-finite -> NaN)", () => {
    expect(idrToCCoin(-5_000)).toBeNaN();
    expect(idrToCCoin(Number.NaN)).toBeNaN();
    expect(idrToCCoin(Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe("ccoinToIdr", () => {
  it("converts at canonical rate", () => {
    expect(ccoinToIdr(30)).toBe(300_000);
    expect(ccoinToIdr(1)).toBe(10_000);
  });
});

describe("calcSignedCount (1 per 10)", () => {
  it("ceils total/10", () => {
    expect(calcSignedCount(15)).toBe(2);
    expect(calcSignedCount(10)).toBe(1);
    expect(calcSignedCount(100)).toBe(10);
    expect(calcSignedCount(1)).toBe(1);
  });

  it("unsigned = total - signed", () => {
    expect(calcUnsignedCount(15)).toBe(13);
    expect(calcUnsignedCount(10)).toBe(9);
  });
});

describe("calcLevel (floor(xp/10)+1, clamp 1..100)", () => {
  it("maps xp to level", () => {
    expect(calcLevel(0).level).toBe(1);
    expect(calcLevel(9).level).toBe(1);
    expect(calcLevel(10).level).toBe(2);
    expect(calcLevel(999).level).toBe(100);
  });

  it("clamps at 100 and never below 1", () => {
    expect(calcLevel(5_000).level).toBe(100);
    expect(calcLevel(-50).level).toBe(1);
  });

  it("assigns tiers", () => {
    expect(calcLevel(0).tier).toBe("bronze");
    expect(calcLevel(100).tier).toBe("silver"); // level 11
    expect(calcLevel(200).tier).toBe("gold"); // level 21
    expect(calcLevel(300).tier).toBe("platinum"); // level 31
    expect(calcLevel(400).tier).toBe("diamond"); // level 41
  });

  it("xpForNextLevel", () => {
    expect(xpForNextLevel(0)).toBe(10);
    expect(xpForNextLevel(15)).toBe(5);
  });
});

describe("isCcoinInteger", () => {
  it("accepts integer >= 1 only", () => {
    expect(isCcoinInteger(1)).toBe(true);
    expect(isCcoinInteger(100)).toBe(true);
    expect(isCcoinInteger(1.5)).toBe(false);
    expect(isCcoinInteger(0)).toBe(false);
    expect(isCcoinInteger(-3)).toBe(false);
  });
});

describe("splitSecondaryFeeCcoin (7,5 / 7,5 / 85)", () => {
  it("splits and preserves the price exactly (integer rounding)", () => {
    for (const price of [1, 7, 10, 30, 45, 99, 100, 123, 1000]) {
      const split = splitSecondaryFeeCcoin(price);
      expect(split.platformCcoin + split.royaltyCcoin + split.sellerCcoin).toBe(price);
      expect(Number.isInteger(split.sellerCcoin)).toBe(true);
    }
  });

  it("100 C sale -> 8/8/84 (round-half-up on 7,5%)", () => {
    const split = splitSecondaryFeeCcoin(100);
    expect(split.platformCcoin).toBe(8);
    expect(split.royaltyCcoin).toBe(8);
    expect(split.sellerCcoin).toBe(84);
  });
});
