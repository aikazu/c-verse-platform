import { describe, expect, it } from "vitest";
import { buildWorkQueue, TEMPLATE, TEMPLATE_ORDER, type WorkQueueCounts } from "./workQueue";

// Pure-logic tests for Dashboard work-queue builder. Mirrors StatusBadge.test.ts
// style: no DOM, no supabase. The queue hides zero-count entries and preserves
// the canonical display order set by ops priority.

const allZero: WorkQueueCounts = {
  shipmentsActionable: 0,
  kycPending: 0,
  disputesOpen: 0,
  payoutsPending: 0,
};

describe("buildWorkQueue", () => {
  it("exposes the canonical label + hint metadata even when all counts are zero (rows just stay hidden)", () => {
    // The queue must always surface a stable metadata contract for callers.
    expect(TEMPLATE_ORDER.map((id) => TEMPLATE[id].label)).toEqual([
      "Pengiriman perlu diproses",
      "KYC menunggu review",
      "Sengketa terbuka",
      "Payout perlu tindakan",
    ]);
    expect(TEMPLATE_ORDER.map((id) => TEMPLATE[id].to)).toEqual(["/orders", "/kyc", "/disputes", "/payouts"]);
    // Zero counts → queue is empty (rows hidden).
    expect(buildWorkQueue(allZero)).toEqual([]);
  });

  it("shows a count for non-zero entries and routes them to the right paths", () => {
    const result = buildWorkQueue({
      shipmentsActionable: 3,
      kycPending: 2,
      disputesOpen: 0,
      payoutsPending: 1,
    });
    expect(result.find((e) => e.id === "shipments")).toMatchObject({ count: 3, to: "/orders" });
    expect(result.find((e) => e.id === "kyc")).toMatchObject({ count: 2, to: "/kyc" });
    expect(result.find((e) => e.id === "payouts")).toMatchObject({ count: 1, to: "/payouts" });
  });

  it("hides zero-count entries but preserves canonical order of the survivors", () => {
    const result = buildWorkQueue({
      shipmentsActionable: 0,
      kycPending: 5,
      disputesOpen: 0,
      payoutsPending: 0,
    });
    expect(result.map((e) => e.id)).toEqual(["kyc"]);
    expect(result[0]).toMatchObject({ count: 5 });
  });

  it("renders — for failed counts (null) without blanking the rest of the row", () => {
    const result = buildWorkQueue({
      shipmentsActionable: 0,
      kycPending: null,
      disputesOpen: 0,
      payoutsPending: 2,
    });
    const kyc = result.find((e) => e.id === "kyc");
    expect(kyc?.count).toBeNull();
    expect(kyc?.label).toBe("KYC menunggu review");
    // Other rows keep their canonical place and values.
    expect(result.find((e) => e.id === "payouts")?.count).toBe(2);
    expect(result.find((e) => e.id === "disputes")).toBeUndefined();
  });

  it("treats a totally missing counts object as an empty queue (zero counts are hidden)", () => {
    const result = buildWorkQueue();
    expect(result).toEqual([]);
  });

  it("treats undefined as zero (hidden) and null as failed-query (shown with '—') within the SAME input", () => {
    // Mixed state: shipments/payouts are undefined (treated as 0 → hidden),
    // kyc is null (failed query → shown as "—"), disputes is 1 (real work).
    const result = buildWorkQueue({
      shipmentsActionable: undefined,
      kycPending: null,
      disputesOpen: 1,
      payoutsPending: undefined,
    });
    expect(result.map((e) => e.id)).toEqual(["kyc", "disputes"]);
    const kyc = result.find((e) => e.id === "kyc");
    expect(kyc?.count).toBeNull();
    expect(kyc?.label).toBe("KYC menunggu review");
    expect(result.find((e) => e.id === "disputes")).toMatchObject({ count: 1 });
    expect(result.find((e) => e.id === "shipments")).toBeUndefined();
    expect(result.find((e) => e.id === "payouts")).toBeUndefined();
  });

  it("preserves canonical TEMPLATE_ORDER across multiple non-zero survivors regardless of magnitude", () => {
    // Scrambled magnitudes to prove order is the canonical template order,
    // not ascending/descending sort by count.
    const result = buildWorkQueue({
      shipmentsActionable: 1,
      kycPending: 99,
      disputesOpen: 5,
      payoutsPending: 42,
    });
    expect(result.map((e) => e.id)).toEqual([...TEMPLATE_ORDER]);
    expect(result.map((e) => e.id)).toEqual(["shipments", "kyc", "disputes", "payouts"]);
  });
});
