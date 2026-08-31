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

  it("every migration with record_platform_revenue emits derived fee literals", () => {
    const platformStr = String(SECONDARY_PLATFORM_PCT); // "0.075"
    const royaltyStr = String(SECONDARY_ROYALTY_PCT); // "0.075"
    const sellerStr = String(SECONDARY_SELLER_PCT); // "0.85"
    const primaryPlatformStr = String(REVENUE_SHARE_PLATFORM_PRODUCED.platform); // "0.7"
    const primaryCreatorStr = String(REVENUE_SHARE_PLATFORM_PRODUCED.creator); // "0.3"

    const migrations = readMigrations();

    // Kumpulan migration yang diketahui berisi record_platform_revenue
    // settlement. Audit 2026-08-23: 5 file.
    const settlerFiles = migrations.filter((m) => m.content.includes("record_platform_revenue"));
    expect(settlerFiles.length).toBeGreaterThanOrEqual(1);

    for (const { file, content } of settlerFiles) {
      // Settler wajib punya fee literal secondary 0.075 (platform) — minimal salah satu
      // ekspresi muncul (e.g. "round(v_xxx * 0.075)" atau "0.075, 'royalty_pct', 0.075").
      expect(content, `${file} harus memuat SECONDARY_PLATFORM_PCT = ${platformStr}`).toContain(platformStr);
    }

    // Magnet: migration yang berisi split primary 70/30 (record_platform_revenue
    // 'primary' + jsonb fee_snapshot). Audit: 04_rpc.sql (sebelumnya
    // 20260817060000_revenue_flow_hardening.sql, dilebur saat konsolidasi).
    // Filter ketat: file harus punya record_platform_revenue DAN explicit 'primary'
    // SEBAGAI source argumen (bukan sebagai bagian acquired_via text di ownership).
    const primarySplit = migrations.filter(
      (m) => m.content.includes("record_platform_revenue") && (m.content.includes("'primary', ") || m.content.includes("'primary',")),
    );
    expect(primarySplit.length, "primary split harus ada di revenue_flow_hardening").toBeGreaterThanOrEqual(1);
    for (const { file, content } of primarySplit) {
      expect(content, `${file} harus memuat platform_pct ${primaryPlatformStr}`).toContain(primaryPlatformStr);
      expect(content, `${file} harus memuat royalty_pct ${primaryCreatorStr}`).toContain(primaryCreatorStr);
    }

    // Fee snapshot secondary: 04_rpc.sql memuat 0.85 seller_pct di jsonb
    // (sebelumnya 20260817060000_revenue_flow_hardening.sql, dilebur saat konsolidasi).
    // Filter ketat: harus punya seller_pct di context fee_snapshot (record_platform_revenue
    // body). Matcher sederhana: substring 'seller_pct' cukup unik untuk jsonb key ini.
    const secondarySnapshot = migrations.filter((m) => m.content.includes("seller_pct") && m.content.includes("record_platform_revenue"));
    expect(secondarySnapshot.length).toBeGreaterThanOrEqual(1);
    for (const { file, content } of secondarySnapshot) {
      expect(content, `${file} harus memuat SECONDARY_SELLER_PCT = ${sellerStr}`).toContain(sellerStr);
    }

    // Settlement eksplisit ceil(* 0.075) — cek per file secondary settle agar
    // masing-masing independently sinkron. Setelah konsolidasi: minimal 1 settler
    // pattern (semua secondary settle sekarang di 04_rpc.sql). Audit 2026-08-31:
    // round() bisa menghasilkan fee 0 di harga kecil (revenue evaporation) —
    // invarian wajib ceil untuk platform+royalty, seller = remainder.
    const roundedSecondary = settlerFiles.filter((m) => contentIncludesRounded(m.content, platformStr));
    expect(roundedSecondary.length, `setidaknya 1 settler harus pakai ceil(* ${platformStr})`).toBeGreaterThanOrEqual(1);

    // Redundant royalty literal muncul dalam settler (ceil atau jsonb).
    expect(
      settlerFiles.some((m) => contentIncludesRounded(m.content, royaltyStr)),
      `royalty literal ${royaltyStr} harus muncul sebagai ceil(* ...) di setidaknya 1 settler`,
    ).toBe(true);

    // round(* 0.075) tidak boleh lagi ada di settler — regression guard ceil.
    expect(
      settlerFiles.some((m) => contentIncludesRoundFn(m.content, platformStr)),
      `settler tidak boleh memakai round(* ${platformStr}) — wajib ceil`,
    ).toBe(false);
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
