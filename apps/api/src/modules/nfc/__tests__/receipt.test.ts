import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueViewReceipt, verifyViewReceipt } from "../receipt.js";

const MASTER = new Uint8Array([0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]);
const OTHER_MASTER = new Uint8Array([255, 238, 221, 204, 187, 170, 153, 136, 119, 102, 85, 68, 51, 34, 17, 0]);

describe("NFC viewer receipt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("accepts a receipt only for its card and master key", async () => {
    const receipt = await issueViewReceipt(MASTER, "card-1");
    await expect(verifyViewReceipt(MASTER, "card-1", receipt)).resolves.toBe(true);
    await expect(verifyViewReceipt(MASTER, "card-2", receipt)).resolves.toBe(false);
    await expect(verifyViewReceipt(OTHER_MASTER, "card-1", receipt)).resolves.toBe(false);
  });

  it("rejects a tampered receipt", async () => {
    const receipt = await issueViewReceipt(MASTER, "card-1");
    const tampered = `${receipt.slice(0, -1)}${receipt.endsWith("a") ? "b" : "a"}`;
    await expect(verifyViewReceipt(MASTER, "card-1", tampered)).resolves.toBe(false);
  });

  it("rejects a receipt after its 60 second lifetime", async () => {
    const receipt = await issueViewReceipt(MASTER, "card-1");
    vi.setSystemTime(new Date("2026-09-05T12:01:01.000Z"));
    await expect(verifyViewReceipt(MASTER, "card-1", receipt)).resolves.toBe(false);
  });
});
