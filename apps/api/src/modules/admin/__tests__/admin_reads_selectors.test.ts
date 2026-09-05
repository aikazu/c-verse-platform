import { beforeEach, describe, expect, it, vi } from "vitest";

type Query = {
  table: string;
  select?: string;
  count?: string;
  filters: Array<[string, ...unknown[]]>;
  order?: [string, unknown];
  limit?: number;
};

const control = vi.hoisted(() => ({
  queries: [] as Query[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  counts: {} as Record<string, number>,
  userDbTokens: [] as string[],
  rpcCalls: [] as string[],
}));

vi.mock("../../../lib/reads.js", () => {
  const db = {
    from(table: string) {
      const query: Query = { table, filters: [] };
      control.queries.push(query);
      const builder = {
        select(columns: string, options?: { count?: string }) {
          query.select = columns;
          query.count = options?.count;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          query.filters.push(["in", column, values]);
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push(["is", column, value]);
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          query.filters.push(["not", column, operator, value]);
          return builder;
        },
        order(column: string, options: unknown) {
          query.order = [column, options];
          return builder;
        },
        limit(value: number) {
          query.limit = value;
          return builder;
        },
      };
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally thenable.
      Object.defineProperty(builder, "then", {
        value: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: control.rows[table] ?? [], count: control.counts[table] ?? 0, error: null }).then(resolve),
      });
      return builder;
    },
  };
  return { readDb: () => db };
});

vi.mock("../../../lib/db.js", () => ({
  userDb: (token: string) => {
    control.userDbTokens.push(token);
    return {
      rpc(name: string) {
        control.rpcCalls.push(name);
        return Promise.resolve({ data: { users: 9, gmvCcoin: 250, secondaryVolCcoin: 75, txCount: 4 }, error: null });
      },
    };
  },
}));

const { getAdminCreators, getAdminDashboard, getAdminDrops, getAdminInvestor, getAdminNfc, getAdminOrders, getAdminPayouts } = await import(
  "../reads.js"
);

function query(table: string, occurrence = 0): Query {
  const found = control.queries.filter((entry) => entry.table === table)[occurrence];
  if (!found) throw new Error(`Missing query for ${table}`);
  return found;
}

describe("admin read selectors", () => {
  beforeEach(() => {
    control.queries = [];
    control.rows = {};
    control.counts = { drops: 2, orders: 3, creators: 1, shipments: 4, kyc_records: 5, disputes: 6, payouts: 7 };
    control.userDbTokens = [];
    control.rpcCalls = [];
  });

  it("mempertahankan count dan filter antrian dashboard", async () => {
    await expect(getAdminDashboard()).resolves.toEqual({
      stats: { drops: 2, orders: 3, creators: 1 },
      counts: { shipmentsActionable: 4, kycPending: 5, disputesOpen: 6, payoutsPending: 7 },
    });

    expect(query("orders").count).toBe("exact");
    expect(query("shipments").filters).toEqual([["in", "status", ["requested", "packed"]]]);
    expect(query("kyc_records").filters).toEqual([["eq", "status", "pending"]]);
    expect(query("disputes").filters).toEqual([["in", "status", ["open", "under_review"]]]);
    expect(query("payouts").filters).toEqual([["in", "status", ["pending", "processing", "failed"]]]);
  });

  it("menjaga proyeksi drop dan hanya memasukkan creator aktif yang tidak disuspend", async () => {
    control.rows = {
      drops: [{ id: "drop-1", title: "Drop Satu", total_units: 15 }],
      creators: [{ user_id: "creator-1", handle: "karina", users: { display_name: "Karina" } }],
    };

    await expect(getAdminDrops()).resolves.toEqual({ drops: control.rows.drops, activeCreators: control.rows.creators });
    expect(query("drops")).toMatchObject({
      select:
        "id,title,series,status,total_units,sold_count,price_ccoin,price_unsigned_ccoin,artwork_url,raffle_end_at,drawn_at,created_at,is_seed",
      order: ["created_at", { ascending: false }],
      limit: 500,
    });
    expect(query("creators").filters).toEqual([
      ["eq", "status", "active"],
      ["eq", "users.role", "creator"],
      ["is", "users.flag_reason", null],
      ["not", "user_id", "is", null],
    ]);
  });

  it("mempertahankan limit dan bentuk read operasional", async () => {
    await Promise.all([getAdminCreators(), getAdminOrders(), getAdminPayouts(), getAdminNfc()]);

    expect(query("users")).toMatchObject({ select: "id,email,display_name,username,role,flag_reason", limit: 500 });
    expect(query("wallets")).toMatchObject({ select: "user_id,hold_payout_until", limit: 1000 });
    expect(query("orders")).toMatchObject({ select: "id,card_id,status,delivery_option,created_at", limit: 100 });
    expect(query("shipments")).toMatchObject({
      select: "id,card_id,requester_id,type,from_location,to_dest,address,status,tracking_number",
      limit: 500,
    });
    expect(query("payout_batches")).toMatchObject({ select: "id,batch_code,status,total_ccoin,total_idr", limit: 500 });
    expect(query("payouts")).toMatchObject({ select: "id,user_id,type,ccoin_amount,idr_amount,status,batch_id", limit: 500 });
    expect(query("nfc_batches")).toMatchObject({ select: "id,batch_code,qty,status", order: ["created_at", { ascending: false }] });
    expect(query("cards", 0)).toMatchObject({ select: "id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status", limit: 50 });
    expect(query("cards", 1)).toMatchObject({
      select: "id,nfc_uid,nfc_short_id,verify_status,status,location,drop_id,drops!inner(is_seed)",
      limit: 50,
      filters: [
        ["eq", "status", "bid_pending"],
        ["eq", "drops.is_seed", true],
      ],
    });
  });

  it("menjalankan investor RPC dengan token admin dan read drop terbatas", async () => {
    await expect(getAdminInvestor("admin-token")).resolves.toMatchObject({ stats: { users: 9 }, drops: [] });

    expect(control.userDbTokens).toEqual(["admin-token"]);
    expect(control.rpcCalls).toEqual(["get_investor_stats"]);
    expect(query("drops")).toMatchObject({ select: "id,title,status,total_units,sold_count", limit: 100 });
  });
});
