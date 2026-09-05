import { describe, expect, it } from "vitest";
import { consumeOAuthContinuation, OAUTH_CONTINUATION_KEY, safeAppPath, saveOAuthContinuation } from "./auth-continuation";

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
}

const ORIGIN = "https://app.c-verse.co";

describe("OAuth continuation", () => {
  it("keeps an app-local path and consumes it only once", () => {
    const storage = new MemoryStorage();
    expect(saveOAuthContinuation("/drops/a-1?pool=premium#raffle", storage, ORIGIN, 1_000)).toBe(true);
    expect(consumeOAuthContinuation(storage, ORIGIN, 1_001)).toBe("/drops/a-1?pool=premium#raffle");
    expect(consumeOAuthContinuation(storage, ORIGIN, 1_002)).toBeNull();
  });

  it("rejects external, protocol-relative, and backslash redirect attempts", () => {
    for (const path of ["https://evil.example", "//evil.example", "/\\evil.example", "/%5Cevil.example"]) {
      expect(safeAppPath(path, ORIGIN)).toBeNull();
    }
    expect(safeAppPath("/cards/card-1", ORIGIN)).toBe("/cards/card-1");
  });

  it("rejects a stale or malformed continuation and removes it", () => {
    const storage = new MemoryStorage();
    storage.setItem(OAUTH_CONTINUATION_KEY, JSON.stringify({ path: "/wallet", createdAt: 0 }));
    expect(consumeOAuthContinuation(storage, ORIGIN, 10 * 60 * 1000 + 1)).toBeNull();
    expect(storage.getItem(OAUTH_CONTINUATION_KEY)).toBeNull();
  });
});
