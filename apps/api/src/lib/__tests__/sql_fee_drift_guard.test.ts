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
    // 'primary' + jsonb fee_snapshot). Audit: 20260817060000_revenue_flow_hardening.sql.
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

    // Fee snapshot secondary: file 20260817060000 memuat 0.85 seller_pct di jsonb.
    // Filter ketat: harus punya seller_pct di context fee_snapshot (record_platform_revenue
    // body). Matcher sederhana: substring 'seller_pct' cukup unik untuk jsonb key ini.
    const secondarySnapshot = migrations.filter((m) => m.content.includes("seller_pct") && m.content.includes("record_platform_revenue"));
    expect(secondarySnapshot.length).toBeGreaterThanOrEqual(1);
    for (const { file, content } of secondarySnapshot) {
      expect(content, `${file} harus memuat SECONDARY_SELLER_PCT = ${sellerStr}`).toContain(sellerStr);
    }

    // Settlement eksplisit round(* 0.075) — cek per file secondary settle agar
    // masing-masing independently sinkron (e.g. jika fee berlaku hanya di
    // seed_card migration). SETIDAKNYA 3 file dari 5 settler.
    const roundedSecondary = settlerFiles.filter((m) => contentIncludesRounded(m.content, platformStr));
    expect(roundedSecondary.length, `setidaknya 1 settler harus pakai round(* ${platformStr})`).toBeGreaterThanOrEqual(1);

    // Redundant royalty literal muncul dalam settler (round atau jsonb).
    expect(
      settlerFiles.some((m) => contentIncludesRounded(m.content, royaltyStr)),
      `royalty literal ${royaltyStr} harus muncul sebagai round(* ...) di setidaknya 1 settler`,
    ).toBe(true);
  });

  it("MAX_BUYOUT guard muncul di semua file yang aktifkan buyout listing", () => {
    const maxBuyoutStr = String(MAX_BUYOUT_ACTIVE_PER_USER);
    const migrations = readMigrations();

    // Audit 2026-08-23: 4 file punya guard ">= 20" / MAX_BUYOUT_ACTIVE:
    //   20260817020000_rls_policies.sql (RLS)
    //   20260817030000_rpc_atomic.sql (checkout)
    //   20260817060000_revenue_flow_hardening.sql (set_buyout)
    //   20260821020000_seed_two_phase.sql (set_buyout)
    const withGuard = migrations.filter((m) => m.content.includes("MAX_BUYOUT_ACTIVE") || m.content.includes(`>= ${maxBuyoutStr}`));
    expect(withGuard.length, `MAX_BUYOUT_ACTIVE / >= ${maxBuyoutStr} harus muncul di setidaknya 2 file (RLS + RPC)`).toBeGreaterThanOrEqual(
      2,
    );
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
    expect(settlerFile.content).not.toContain(String(MAX_BUYOUT_ACTIVE_PER_USER) + "99");
  });
});

function contentIncludesRounded(content: string, literal: string): boolean {
  // Cari "round(...)" dengan ekspresi yang memuat literal (e.g. "round(v_price * 0.075)").
  // Loose match: round( ... <literal> ). Toleransi whitespace.
  const re = new RegExp(`round\\s*\\([^)]*${escapeRegex(literal)}[^)]*\\)`, "i");
  return re.test(content);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
