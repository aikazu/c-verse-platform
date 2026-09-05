// C.Verse — Mirror sync: Platform/docs <-> 00_Dream_Project/dev-strategy
//
// Per AGENTS.md: `docs/` adalah MIRROR byte-identik dari spec repo
// (00_Dream_Project/dev-strategy/). File .md disinkron dua arah. Spec repo
// hanya berisi markdown spec (TIDAK ada SQL/migrations); SQL hidup eksklusif
// di Platform/supabase/migrations/.
//
// Default direction: Platform -> spec (propagate implementation reality
// back to spec). Gunakan --reverse ketika spec jadi canonical source
// (mis. keputusan desain baru).
//
// Usage:
//   node sync-docs.mjs                  Sync Platform/docs -> spec (default)
//   node sync-docs.mjs --reverse       Sync spec -> Platform/docs
//   node sync-docs.mjs --check          Dry-run, print what would change
//   node sync-docs.mjs --target <path> Override spec repo path
//   node sync-docs.mjs --source <path> Override source docs path
//
// Exit codes:
//   0  success (no changes OR all changes applied)
//   1  error (path missing, IO failure)
//   2  mirror differs in check mode, or extra target files need review
//
// Tidak auto-commit / auto-push — biarkan user review & commit manual.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Config ─────────────────────────────────────────────────────────────
// Default spec repo path per AGENTS.md. Bisa di-override via --target.
const DEFAULT_SPEC_ROOT = "C:\\Users\\iqbal\\Documents\\C-Verse\\00_Dream_Project";
const DEFAULT_SPEC_DOCS = join(DEFAULT_SPEC_ROOT, "dev-strategy");
const DEFAULT_PLATFORM_DOCS = resolve("docs");

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getFlag(name, fallback = null) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return i + 1 < args.length ? args[i + 1] : fallback;
}
const reverse = args.includes("--reverse");
const checkOnly = args.includes("--check");
const targetPath = getFlag("--target", DEFAULT_SPEC_DOCS);
const sourcePath = getFlag("--source", DEFAULT_PLATFORM_DOCS);

const fromPath = reverse ? targetPath : sourcePath;
const toPath = reverse ? sourcePath : targetPath;
const directionLabel = reverse ? "spec -> Platform" : "Platform -> spec";

// ── Helpers ──────────────────────────────────────────────────────────
function listMd(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return null;
  }
}

function fmtSize(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Main ──────────────────────────────────────────────────────────────
console.log(`Mirror sync: ${directionLabel}`);
console.log(`  from: ${fromPath}`);
console.log(`    to: ${toPath}`);
console.log(`  mode: ${checkOnly ? "check (dry-run)" : "apply"}`);
console.log("─".repeat(72));

const fromFiles = listMd(fromPath);
const toFiles = listMd(toPath);

if (fromFiles === null) {
  console.error(`✗ source directory not found: ${fromPath}`);
  process.exit(1);
}
if (toFiles === null) {
  console.error(`✗ target directory not found: ${toPath}`);
  process.exit(1);
}

const fromSet = new Set(fromFiles);
const toSet = new Set(toFiles);
const common = [...fromSet].filter((f) => toSet.has(f)).sort();
const onlyInFrom = [...fromSet].filter((f) => !toSet.has(f)).sort();
const onlyInTo = [...toSet].filter((f) => !fromSet.has(f)).sort();

let identicalCount = 0;
let updatedCount = 0;
let createdCount = 0;
let asymmetricError = false;

// Compare & sync common files
for (const f of common) {
  const srcPath = join(fromPath, f);
  const tgtPath = join(toPath, f);
  const srcBuf = readFileSync(srcPath);
  const tgtBuf = readFileSync(tgtPath);

  if (srcBuf.equals(tgtBuf)) {
    process.stdout.write(`  ✓ ${f.padEnd(36)} identical\n`);
    identicalCount += 1;
    continue;
  }

  const diffBytes = Math.abs(srcBuf.length - tgtBuf.length);
  // Tally update count regardless of mode — dry-run should still report
  // the *would-be* count so callers can decide whether to apply.
  updatedCount += 1;
  if (checkOnly) {
    process.stdout.write(
      `  M ${f.padEnd(36)} differ  src=${fmtSize(srcBuf.length)}  tgt=${fmtSize(tgtBuf.length)}  Δ=${fmtSize(diffBytes)}\n`,
    );
  } else {
    writeFileSync(tgtPath, srcBuf);
    process.stdout.write(`  ✓ ${f.padEnd(36)} synced   src=${fmtSize(srcBuf.length)}  tgt was=${fmtSize(tgtBuf.length)}\n`);
  }
}

// Files only in source (not in target)
for (const f of onlyInFrom) {
  const srcPath = join(fromPath, f);
  const srcBuf = readFileSync(srcPath);
  createdCount += 1;
  if (checkOnly) {
    process.stdout.write(`  + ${f.padEnd(36)} NEW (only in source, would copy)\n`);
  } else {
    const tgtPath = join(toPath, f);
    writeFileSync(tgtPath, srcBuf);
    process.stdout.write(`  + ${f.padEnd(36)} copied (new in target)\n`);
  }
}

// Files only in target (not in source) — manual edit, leave alone but warn
for (const f of onlyInTo) {
  process.stdout.write(`  ! ${f.padEnd(36)} ONLY IN TARGET — manual edit, leave alone\n`);
  asymmetricError = true;
}

console.log("─".repeat(72));
if (checkOnly) {
  console.log(`Would update ${updatedCount + createdCount} file(s). Run without --check to apply.`);
} else {
  console.log(`Done. ${updatedCount} updated, ${createdCount} created, ${identicalCount} identical.`);
}
if (asymmetricError) {
  console.log(
    `⚠ ${onlyInTo.length} file(s) exist ONLY in target. Per AGENTS.md mirror rule, this indicates a manual edit — review and reconcile before next sync.`,
  );
  process.exit(2);
}
if (checkOnly && updatedCount + createdCount > 0) process.exitCode = 2;
