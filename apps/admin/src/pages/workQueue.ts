// Dashboard operational work queue — counts of items awaiting admin action.
//
// Status filters mirror the sibling pages exactly:
//   - shipmentsActionable → Orders page (shipments in `requested` or `packed`)
//   - kycPending          → Kyc page (status = `pending`)
//   - disputesOpen        → Disputes page (status `open` or `under_review`)
//   - payoutsPending      → Payouts page (status `pending` | `processing` | `failed`)
//
// The helper is pure so it can be unit-tested without supabase/React. The
// dashboard calls Promise.all head-counts, then funnels results through
// `buildWorkQueue` to keep the rendered order + zero-hiding deterministic.

export type WorkQueueCounts = {
  shipmentsActionable: number | null;
  kycPending: number | null;
  disputesOpen: number | null;
  payoutsPending: number | null;
};

export type WorkQueueEntry = {
  id: "shipments" | "kyc" | "disputes" | "payouts";
  label: string;
  hint: string;
  // null = the count query failed for this row; render "—" rather than blanking
  // the rest of the queue.
  count: number | null;
  to: string;
};

const CANONICAL_ORDER: ReadonlyArray<WorkQueueEntry["id"]> = ["shipments", "kyc", "disputes", "payouts"];

// Exported for tests + consumers that want to render all rows even when zero
// (e.g. the dashboard fallback when no query has succeeded yet).
export const TEMPLATE_ORDER: ReadonlyArray<WorkQueueEntry["id"]> = CANONICAL_ORDER;

export const TEMPLATE: Record<WorkQueueEntry["id"], Omit<WorkQueueEntry, "count">> = {
  shipments: {
    id: "shipments",
    label: "Pengiriman perlu diproses",
    hint: "Shipment menunggu packing atau kirim",
    to: "/orders",
  },
  kyc: {
    id: "kyc",
    label: "KYC menunggu review",
    hint: "Pengajuan KYC berstatus pending",
    to: "/kyc",
  },
  disputes: {
    id: "disputes",
    label: "Sengketa terbuka",
    hint: "Dispute open atau under_review",
    to: "/disputes",
  },
  payouts: {
    id: "payouts",
    label: "Payout perlu tindakan",
    hint: "Menunggu batch atau perlu refund",
    to: "/payouts",
  },
};

export function buildWorkQueue(counts: Partial<WorkQueueCounts> = {}): WorkQueueEntry[] {
  const normalize = (v: number | null | undefined): number | null => {
    // Distinguish three states:
    //   - undefined / missing key → 0 (no work)
    //   - null                    → failed query (render "—")
    //   - number                  → use as-is
    if (v === undefined) return 0;
    return v;
  };
  const all: Record<WorkQueueEntry["id"], number | null> = {
    shipments: normalize(counts.shipmentsActionable),
    kyc: normalize(counts.kycPending),
    disputes: normalize(counts.disputesOpen),
    payouts: normalize(counts.payoutsPending),
  };
  return CANONICAL_ORDER.filter((id) => {
    const v = all[id];
    // Keep entries with a positive count OR with a failed query (null) — the
    // dashboard renders "—" for the latter so a transient error doesn't blank
    // the row. Hide true zero counts so the queue surfaces real work only.
    if (v === null) return true;
    return Number.isFinite(v) && v > 0;
  }).map((id) => ({ ...TEMPLATE[id], count: all[id] }));
}
