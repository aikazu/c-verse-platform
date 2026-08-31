import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError, rpcCheckout } from "../db.js";

// Lane E remediation (audit 2026-08-31): callRpc previously (a) echoed the raw
// Postgres/PostgREST message for unmapped error codes and (b) kept the whole
// "CODE: detail" first line in err.code, so `err.code === "PERMISSION_DENIED"`
// branches in admin routes never matched. These tests pin the contract:
// err.code is the bare UPPER_SNAKE token, the client message is always
// mapped-or-generic, and raw text exists only in server-side logs.

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeDb(result: RpcResult): SupabaseClient {
  return { rpc: () => Promise.resolve(result) } as unknown as SupabaseClient;
}

async function rpcErrorOf(result: RpcResult): Promise<RpcError> {
  const err = await rpcCheckout(fakeDb(result), "drop-1").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RpcError);
  return err as RpcError;
}

describe("callRpc error mapping (lib/db.ts)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("unmapped raw Postgres error -> generic 'Operasi gagal', raw text logged server-side only", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = "Could not find the function public.checkout in the schema cache";
    const err = await rpcErrorOf({ data: null, error: { message: raw } });
    expect(err.message).toBe("Operasi gagal");
    expect(err.message).not.toContain("schema cache");
    const logged = errSpy.mock.calls.map((call) => call.map((a) => String(a)).join(" ")).join("\n");
    expect(logged).toContain("schema cache");
  });

  it("duplicate key violation -> generic, never the constraint name", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await rpcErrorOf({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "cards_pkey"' },
    });
    expect(err.message).toBe("Operasi gagal");
    expect(err.message).not.toContain("cards_pkey");
  });

  it("'CODE: detail' raise -> err.code is the bare UPPER_SNAKE token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await rpcErrorOf({
      data: null,
      error: { message: "PERMISSION_DENIED: cancel_seed_sale requires service_role" },
    });
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.message).toBe("Akses ditolak — RPC ini hanya boleh dipanggil oleh service_role");
  });

  it("mapped business token keeps its Indonesian message (not the raw token)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await rpcErrorOf({ data: null, error: { message: "INSUFFICIENT" } });
    expect(err.code).toBe("INSUFFICIENT");
    expect(err.message).toBe("Saldo C-Coin tidak cukup");
  });

  it("multi-line message -> code from the first line only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await rpcErrorOf({ data: null, error: { message: "SOLD_OUT\nHINT: units exhausted" } });
    expect(err.code).toBe("SOLD_OUT");
    expect(err.message).toBe("Unit sudah habis");
  });

  it("04_rpc.sql sweep: previously unmapped business codes are now mapped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases: Array<[string, string]> = [
      ["CARD_NOT_IN_VAULT", "vault"],
      ["SHIPMENT_ACTIVE", "pengiriman"],
      ["SEED_SALE_IN_PROGRESS", "seed"],
    ];
    for (const [code, fragment] of cases) {
      const err = await rpcErrorOf({ data: null, error: { message: code } });
      expect(err.code).toBe(code);
      expect(err.message).toContain(fragment);
      expect(err.message).not.toBe(code);
    }
  });

  it("INVALID_LEADERBOARD_TYPE with detail -> mapped, code stripped of the suffix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await rpcErrorOf({
      data: null,
      error: { message: "INVALID_LEADERBOARD_TYPE: foo, expected xp|cards|badges|creator" },
    });
    expect(err.code).toBe("INVALID_LEADERBOARD_TYPE");
    expect(err.message).toBe("Tipe leaderboard tidak valid (xp|cards|badges|creator)");
  });
});
