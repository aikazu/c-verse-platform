import { describe, expect, it } from "vitest";
import { randomHex, uid } from "./store.js";

describe("randomHex", () => {
  it("returns 2 lowercase hex chars per byte", () => {
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(8)).toHaveLength(16);
  });

  it("does not repeat across calls (crypto-random)", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => randomHex(8)));
    expect(seen.size).toBe(1000);
  });
});

describe("uid", () => {
  it("keeps the given prefix and stays hex-safe after it", () => {
    const id = uid("kyc-");
    expect(id.startsWith("kyc-")).toBe(true);
    expect(id.slice(4)).toMatch(/^[0-9a-z]+$/);
  });
});
