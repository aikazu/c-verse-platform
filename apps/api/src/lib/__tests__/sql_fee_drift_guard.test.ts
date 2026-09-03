import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Fee drift guard ──────────────────────────────────────────────────────
// Hardcoded fee/share literals (0.075, 0.85, 0.7/0.3) dan threshold
// (MAX_BUYOUT 20) tersebar di supabase/migrations/*.sql — setiap settle
// path (primary 70/30 + secondary 7,5/7,5/85) harus konsisten dengan
// packages/shared/src/index.ts sebagai canonical source of truth.
//
// Test ini FAIL jika: shared constant berubah TANPA update SQL terkait,
// karena assertion membuktikan SQL berisi literal yang DIHITUNG dari
// nilai shared. Implement: pakai String(constant) langsung sebagai
// substring — sederhana, non-brittle (format SQL boleh beda asal nilai
// shared muncul utuh dalam ekspresi).
// ─────────────────────────────────────────────────────────────────────────

import {
  MAX_BUYOUT_ACTIVE_PER_USER,
  REVENUE_SHARE_PLATFORM_PRODUCED,
  SECONDARY_PLATFORM_PCT,
  SECONDARY_ROYALTY_PCT,
  SECONDARY_SELLER_PCT,
  SHIPMENT_FEE_CCOIN,
} from "@c-verse/shared";

// Path repo root: dari apps/api/src/lib/__tests__ naik 5 level ke repo root
// (apps/<repo>/supabase/migrations). Hitung: __tests__ -> lib -> src -> api -> apps -> repo.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

function readMigrations(): { file: string; content: string }[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => ({
    file,
    content: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
  }));
}

describe("SQL fee drift guard — shared constants vs migration literals", () => {
  // Pin exact shared values — kalau diubah tanpa SQL, ini yang pertama gagal.
  it("shared fee & threshold constants pin exact values", () => {
    expect(SECONDARY_PLATFORM_PCT).toBe(0.075);
    expect(SECONDARY_ROYALTY_PCT).toBe(0.075);
    expect(SECONDARY_SELLER_PCT).toBe(0.85);
    expect(REVENUE_SHARE_PLATFORM_PRODUCED.platform).toBe(0.7);
    expect(REVENUE_SHARE_PLATFORM_PRODUCED.creator).toBe(0.3);
    expect(MAX_BUYOUT_ACTIVE_PER_USER).toBe(20);
    expect(SHIPMENT_FEE_CCOIN).toBe(2);
  });

  it("settlement call-sites and the revenue definition stay in sync with shared fee literals", () => {
    const platformStr = String(SECONDARY_PLATFORM_PCT); // "0.075"
    const royaltyStr = String(SECONDARY_ROYALTY_PCT); // "0.075"
    const sellerStr = String(SECONDARY_SELLER_PCT); // "0.85"
    const primaryPlatformStr = String(REVENUE_SHARE_PLATFORM_PRODUCED.platform); // "0.7"
    const primaryCreatorStr = String(REVENUE_SHARE_PLATFORM_PRODUCED.creator); // "0.3"

    const migrations = readMigrations();

    // Definisi revenue — TEPAT 1 file (04b_rpc_ledger_gamification.sql pasca-split
    // 04_rpc.sql → 04a–04k). Body definisi memuat SEMUA literal fee: split primary
    // 0.7/0.3 + secondary 0.075/0.075/0.85 via jsonb key seller_pct.
    const definitionFiles = migrations.filter((m) => m.content.includes("create or replace function public.record_platform_revenue("));
    expect(definitionFiles.length, "definisi record_platform_revenue harus tepat 1 file").toBe(1);
    const definition = definitionFiles[0];
    expect(definition.content, `${definition.file} harus memuat SECONDARY_PLATFORM_PCT = ${platformStr}`).toContain(platformStr);
    expect(definition.content, `${definition.file} harus memuat SECONDARY_ROYALTY_PCT = ${royaltyStr}`).toContain(royaltyStr);
    expect(definition.content, `${definition.file} harus memuat SECONDARY_SELLER_PCT = ${sellerStr}`).toContain(sellerStr);
    expect(definition.content, `${definition.file} harus memuat platform share ${primaryPlatformStr}`).toContain(primaryPlatformStr);
    expect(definition.content, `${definition.file} harus memuat creator share ${primaryCreatorStr}`).toContain(primaryCreatorStr);
    expect(definition.content, `${definition.file} harus memuat jsonb key seller_pct`).toContain("seller_pct");

    // Call-site settlement: perform public.record_platform_revenue(...) — tersebar
    // per-domain pasca-split: 04c (purchase/shipout), 04d (raffle draw), 04f
    // (secondary settle), 04h (seed service).
    const callerFiles = migrations.filter((m) => m.content.includes("perform public.record_platform_revenue("));
    expect(callerFiles.length, "minimal 1 call-site settlement harus ada").toBeGreaterThanOrEqual(1);

    // Secondary callers (04f/04h): fee platform+royalty wajib ceil — audit
    // 2026-08-31: round() bisa menghasilkan fee 0 di harga kecil (revenue
    // evaporation); seller = remainder (tidak di-round/ceil).
    const secondaryCallers = callerFiles.filter((m) => m.content.includes("'secondary"));
    expect(secondaryCallers.length, "minimal 1 secondary caller harus ada").toBeGreaterThanOrEqual(1);
    for (const { file, content } of secondaryCallers) {
      expect(contentIncludesRounded(content, platformStr), `${file} harus pakai ceil(* ${platformStr}) untuk platform fee`).toBe(true);
      expect(contentIncludesRounded(content, royaltyStr), `${file} harus pakai ceil(* ${royaltyStr}) untuk royalty fee`).toBe(true);
      expect(contentIncludesRoundFn(content, platformStr), `${file} tidak boleh memakai round(* ${platformStr}) — wajib ceil`).toBe(false);
    }

    // Primary callers (04c/04d): creator share 0.3 eksplisit di call-site;
    // platform = remainder sehingga literal 0.7 memang tidak muncul di sini.
    const primaryCallers = callerFiles.filter((m) => m.content.includes("'primary'"));
    expect(primaryCallers.length, "minimal 1 primary caller harus ada").toBeGreaterThanOrEqual(1);
    for (const { file, content } of primaryCallers) {
      expect(content, `${file} harus memuat creator share ${primaryCreatorStr}`).toContain(primaryCreatorStr);
    }
  });

  it("MAX_BUYOUT guard muncul di semua file yang aktifkan buyout listing", () => {
    const maxBuyoutStr = String(MAX_BUYOUT_ACTIVE_PER_USER);
    const migrations = readMigrations();

    // Audit 2026-08-23: 4 file punya guard ">= 20" / MAX_BUYOUT_ACTIVE. Setelah
    // konsolidasi (04_rpc.sql untuk RPC, 03_rls.sql untuk RLS guard):
    //   03_rls.sql (cards_buyout_guard — RLS guard)
    //   04_rpc.sql::set_buyout + checkout (MAX_BUYOUT_ACTIVE check)
    const withGuard = migrations.filter((m) => m.content.includes("MAX_BUYOUT_ACTIVE") || m.content.includes(`>= ${maxBuyoutStr}`));
    expect(withGuard.length, `MAX_BUYOUT_ACTIVE / >= ${maxBuyoutStr} harus muncul di setidaknya 2 file (RLS + RPC)`).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("SHIPMENT_FEE_CCOIN pin: fee literal di-derive di dalam blok fungsi vault_shipout (04_rpc.sql)", () => {
    const feeStr = String(SHIPMENT_FEE_CCOIN);
    const migrations = readMigrations();

    const rpcFile = migrations.find((m) => m.content.includes("create or replace function public.vault_shipout("));
    expect(rpcFile, "fungsi vault_shipout harus ada di migrations").toBeDefined();
    if (!rpcFile) return;

    const start = rpcFile.content.indexOf("create or replace function public.vault_shipout(");
    const end = rpcFile.content.indexOf("$$;", start);
    const fnBody = rpcFile.content.slice(start, end);

    // Fee BUKAN parameter RPC — bukan input client (audit 2026-08-31:
    // client-supplied fee underchargable). Guard: param lama tidak boleh kembali.
    expect(fnBody).not.toContain("p_fee_ccoin");
    // Fee di-derive dari konstanta lokal yang meng-pin SHIPMENT_FEE_CCOIN.
    expect(fnBody, `${rpcFile.file}::vault_shipout harus memuat literal fee ${feeStr}`).toContain(`integer := ${feeStr}`);
  });

  it("red-check: matcher akan FAIL jika fee literal diubah ke nilai salah", () => {
    // Sanity check bahwa toContain benar-benar sensitif: kalau expected
    // tidak cocok dengan SQL, test gagal — yaitu intent drift-guard ini.
    const migrations = readMigrations();
    const settlerFile = migrations.find((m) => m.content.includes("record_platform_revenue"));
    expect(settlerFile).toBeDefined();
    if (!settlerFile) return;

    // Salah satu pattern yang BENAR ada; salah satu pattern SALAH tidak.
    expect(settlerFile.content).toContain(String(SECONDARY_PLATFORM_PCT));
    expect(settlerFile.content).not.toContain("0.999_WRONG");
    expect(settlerFile.content).not.toContain(`${String(MAX_BUYOUT_ACTIVE_PER_USER)}99`);
  });
});

function contentIncludesRounded(content: string, literal: string): boolean {
  // Cari "ceil(...)" dengan ekspresi yang memuat literal (e.g. "ceil(v_price * 0.075)").
  // Nama historis; invarian kini ceil (audit 2026-08-31 — round bisa fee 0).
  // Loose match: ceil( ... <literal> ). Toleransi whitespace.
  const re = new RegExp(`ceil\\s*\\([^)]*${escapeRegex(literal)}[^)]*\\)`, "i");
  return re.test(content);
}

function contentIncludesRoundFn(content: string, literal: string): boolean {
  const re = new RegExp(`round\\s*\\([^)]*\\*\\s*${escapeRegex(literal)}`, "i");
  return re.test(content);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
