import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const EXPECTED_FILES = [
  "01_schema.sql",
  "02_schema_tables.sql",
  "03_schema_grants.sql",
  "04_auth.sql",
  "05_rls.sql",
  "06_rls_policies.sql",
  "07_rpc_wallet_kernel.sql",
  "08_rpc_ledger_gamification.sql",
  "09_rpc_purchase_shipout.sql",
  "10_rpc_raffle_draw.sql",
  "11_rpc_bids_listing.sql",
  "12_rpc_secondary_settle.sql",
  "13_rpc_payouts_admin.sql",
  "14_rpc_seed_service.sql",
  "15_rpc_notify_triggers.sql",
  "16_rpc_reads.sql",
  "17_rpc_grants.sql",
  "18_indexes.sql",
];

function readMigrations(): { file: string; content: string; lines: number }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      return { file, content, lines: content.split(/\r?\n/).length };
    });
}

describe("SQL baseline migration guard", () => {
  it("keeps exactly the ordered 18-file baseline, each at most 500 physical LOC", () => {
    const migrations = readMigrations();

    expect(migrations).toHaveLength(18);
    expect(migrations.map(({ file }) => file)).toEqual(EXPECTED_FILES);
    for (const { file, lines } of migrations) {
      expect(lines, `${file} must stay within the 500 physical LOC ceiling`).toBeLessThanOrEqual(500);
    }
  });

  it("defines every public function once in the clean baseline", () => {
    const definitions = new Map<string, string[]>();
    const functionPattern = /^\s*create\s+(?:or\s+replace\s+)?function\s+(public\.[a-z0-9_]+)/gim;

    for (const { file, content } of readMigrations()) {
      for (const match of content.matchAll(functionPattern)) {
        const name = match[1];
        definitions.set(name, [...(definitions.get(name) ?? []), file]);
      }
    }

    const duplicates = [...definitions.entries()].filter(([, files]) => files.length > 1);
    expect(duplicates, "clean baseline must not rely on later function overrides").toEqual([]);
  });

  it("pins final least-privilege revokes instead of relying on default privileges", () => {
    const grants = readMigrations().find(({ file }) => file === "03_schema_grants.sql");

    expect(grants).toBeDefined();
    const content = grants?.content ?? "";
    expect(content).toContain("revoke select on public.bids from authenticated;");
    expect(content).toContain("revoke insert on public.bids from authenticated;");
    expect(content).toContain("revoke select on public.ownership_history from authenticated;");
    expect(content).toContain("revoke select on public.creators from authenticated;");
  });
});
