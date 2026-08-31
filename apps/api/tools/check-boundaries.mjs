#!/usr/bin/env node
/**
 * check-boundaries.mjs — zero-dependency boundary enforcement for apps/api/src.
 *
 * Rules over apps/api/src .ts/.mts files (relative import specifiers only):
 *  - R1 KERNEL PURITY: files under src/lib/ must not import anything under src/modules/.
 *  - R2 MODULE PRIVACY: a file inside modules/<x>/ may import into modules/<y>/ (y !== x)
 *    ONLY via the module entry `<y>/index.ts` (specifier ending in `<y>/index.js`).
 *  - R3 OUTSIDE ACCESS: files outside modules/ (index.ts, server.ts, src/__tests__/)
 *    may import into modules/<x>/ ONLY via `<x>/index.ts`.
 *
 * Usage:
 *   node tools/check-boundaries.mjs             # scan the real tree, exit 1 on violations
 *   node tools/check-boundaries.mjs --self-test # run fixture assertions in a temp dir
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ABS_WINDOWS_PATH = /^\/[A-Za-z]:\//;

/** Absolute dir of this script, derived without node:url (works on win32 + posix). */
function getToolDir() {
  const raw = decodeURIComponent(import.meta.url);
  const stripped = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  const filePath = ABS_WINDOWS_PATH.test(stripped) ? stripped.slice(1) : stripped;
  return path.dirname(filePath);
}

const TOOL_DIR = getToolDir();
const API_ROOT = path.resolve(TOOL_DIR, "..");
const SRC_DIR = path.resolve(API_ROOT, "src");

/** Normalize a host path to posix form for deterministic classification. */
function toPosix(value) {
  return value.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Import extraction (mechanical, specifier-text based)
// ---------------------------------------------------------------------------

const STATIC_IMPORT_RE = /\bfrom\s*(["'])([^"'\n]+)\1/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*(["'])([^"'\n]+)\1/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(["'])([^"'\n]+)\1/g;
// Template-literal dynamic import: import(`./x.js`) — plain specifiers only
// (`$` excluded so interpolated templates are never resolved as literals).
const TEMPLATE_DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(`)([^`$\n]+)\1/g;

/**
 * Extract relative import specifiers from source text.
 * Covers: static `from "..."`, `export ... from "..."`, side-effect `import "..."`,
 * dynamic `import("...")` and `import(\`...\`)`. Returns [{ specifier, line }], deduped, sorted by line.
 */
function extractImports(source) {
  const found = new Map();
  const regexes = [STATIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE, TEMPLATE_DYNAMIC_IMPORT_RE];
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match !== null) {
      // Match tail is: opening-quote + specifier + closing-quote.
      const specifier = match[2];
      const quoteIndex = match.index + match[0].length - specifier.length - 2;
      const line = source.slice(0, quoteIndex).split("\n").length;
      found.set(`${line}\u0000${specifier}`, { specifier, line });
      match = regex.exec(source);
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

/** Resolve a relative specifier against the importer dir (posix), mapping trailing .js -> .ts. */
function resolveTargetTs(importerAbsPosix, specifier) {
  const importerDir = path.posix.dirname(importerAbsPosix);
  const resolved = path.posix.normalize(path.posix.join(importerDir, specifier));
  if (resolved.endsWith(".js")) {
    return `${resolved.slice(0, -3)}.ts`;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

/** Classify a file path (posix, absolute) against src boundaries. */
function zoneOf(filePosix, srcPosix) {
  if (filePosix.startsWith(`${srcPosix}/lib/`)) {
    return { kind: "lib", moduleName: null };
  }
  const modulesRoot = `${srcPosix}/modules/`;
  if (filePosix.startsWith(modulesRoot)) {
    const moduleName = filePosix.slice(modulesRoot.length).split("/")[0];
    return { kind: "module", moduleName };
  }
  return { kind: "outside", moduleName: null };
}

/** Module segment for a target path under src/modules/, else null. */
function moduleOf(targetTsPosix, srcPosix) {
  const modulesRoot = `${srcPosix}/modules/`;
  if (!targetTsPosix.startsWith(modulesRoot)) {
    return null;
  }
  return targetTsPosix.slice(modulesRoot.length).split("/")[0];
}

/** True when the target is exactly a module entry `<x>/index.ts`. */
function isModuleEntry(targetTsPosix, srcPosix, moduleName) {
  return targetTsPosix === `${srcPosix}/modules/${moduleName}/index.ts`;
}

/**
 * Decide which rules an import violates.
 * zone: importer classification; targetModule: name or null (non-module target = out of scope).
 * Returns an array of rule ids (empty = legal).
 */
function decideRule(zone, targetModule, isEntry) {
  // R1: the kernel never reaches into feature modules (even via the entry).
  if (zone.kind === "lib") {
    return ["R1"];
  }
  // R2: cross-module access is legal only through the sibling module entry.
  if (zone.kind === "module" && zone.moduleName !== targetModule && !isEntry) {
    return ["R2"];
  }
  // R3: root/tests may import a module only via its entry.
  if (zone.kind === "outside" && !isEntry) {
    return ["R3"];
  }
  return [];
}

/**
 * Scan a src directory tree and collect boundary violations.
 * Returns [{ rule, file (abs posix), line, specifier }], sorted deterministically.
 */
function collectViolations(srcDirAbs) {
  const srcPosix = toPosix(srcDirAbs);
  const violations = [];

  const walk = (dirAbs) => {
    const entries = readdirSync(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      const entryAbs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        walk(entryAbs);
        continue;
      }
      const fileName = entry.name;
      const isTypeScript = fileName.endsWith(".ts") || fileName.endsWith(".mts");
      const isDeclaration = fileName.endsWith(".d.ts") || fileName.endsWith(".d.mts");
      if (!isTypeScript || isDeclaration) {
        continue;
      }
      // Test files are exempt as importers: white-box by design and never imported by production.
      if (fileName.endsWith(".test.ts") || fileName.endsWith(".test.mts")) {
        continue;
      }
      const filePosix = toPosix(entryAbs);
      const source = readFileSync(entryAbs, "utf8");
      const zone = zoneOf(filePosix, srcPosix);
      for (const { specifier, line } of extractImports(source)) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          continue;
        }
        const targetTs = resolveTargetTs(filePosix, specifier);
        const targetModule = moduleOf(targetTs, srcPosix);
        if (targetModule === null) {
          continue;
        }
        const isEntry = isModuleEntry(targetTs, srcPosix, targetModule);
        for (const rule of decideRule(zone, targetModule, isEntry)) {
          violations.push({ rule, file: filePosix, line, specifier });
        }
      }
    }
  };

  walk(srcDirAbs);
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return violations;
}

// ---------------------------------------------------------------------------
// Real-tree run
// ---------------------------------------------------------------------------

function formatViolation(violation, displayRoot, prefix) {
  const relFile = toPosix(path.relative(displayRoot, violation.file));
  return `VIOLATION [${violation.rule}] ${prefix}${relFile}:${violation.line} imports "${violation.specifier}"`;
}

function runRealCheck() {
  const violations = collectViolations(SRC_DIR);
  for (const violation of violations) {
    console.log(formatViolation(violation, API_ROOT, "apps/api/"));
  }
  const summary = violations.length === 0 ? "0 boundary violations — clean." : `${violations.length} boundary violation(s) found.`;
  console.log(summary);
  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Self-test (fixture-based, temp dir)
// ---------------------------------------------------------------------------

const FIXTURES = new Map([
  // --- set A: must be flagged ---
  [
    "src/lib/kernel.ts",
    ['import { readFile } from "node:fs";', 'import { z } from "zod-ish";', 'export { helper } from "../modules/a/routes.js";'].join("\n"),
  ],
  ["src/modules/a/routes.ts", ['import { bRoutes } from "../b/routes.js";', "export const aRoutes = bRoutes;"].join("\n")],
  // Backtick dynamic import inside a .mts file — must be caught like any other import.
  ["src/modules/a/lazy.mts", ["const lazyB = await import(`../b/routes.js`);", "export const lazyValue = lazyB;"].join("\n")],
  ["src/index.ts", ['const mod = await import("./modules/a/routes.js");', "export const rootValue = mod;"].join("\n")],
  ["src/__tests__/file.ts", ['import { readValue } from "../modules/a/reads.js";', "export const t = readValue;"].join("\n")],
  // --- set B: must pass clean ---
  [
    "src/modules/a/__tests__/kernel.test.ts",
    ['import { readValue } from "../../b/reads.js";', "export const testRef = readValue;"].join("\n"),
  ],
  [
    "src/__tests__/whitebox.test.ts",
    ['import { readValue } from "../modules/a/reads.js";', "export const testValue = readValue;"].join("\n"),
  ],
  ["src/modules/a/client.ts", ['import { modB } from "../b/index.js";', "export const clientValue = modB;"].join("\n")],
  ["src/server.ts", ['import { app } from "./modules/a/index.js";', 'export { app } from "./modules/a/index.js";'].join("\n")],
  ["src/lib/util.ts", ['import { kernelValue } from "./kernel.js";', "export const utilValue = kernelValue;"].join("\n")],
  ["src/modules/a/reads.ts", ['import { internalValue } from "./internal.js";', "export const readValue = internalValue;"].join("\n")],
  ["src/modules/a/index.ts", ['export { default } from "./routes.js";'].join("\n")],
  ["src/modules/b/index.ts", ['export const modB = "b";'].join("\n")],
  ["src/modules/b/routes.ts", ['export const bRoutes = "b-routes";'].join("\n")],
  ["src/modules/b/reads.ts", ['export const readValue = "b-reads";'].join("\n")],
  ["src/modules/a/internal.ts", ['export const internalValue = "a-internal";'].join("\n")],
]);

const EXPECTED_VIOLATIONS = [
  { rule: "R1", file: "src/lib/kernel.ts", line: 3, specifier: "../modules/a/routes.js" },
  { rule: "R2", file: "src/modules/a/routes.ts", line: 1, specifier: "../b/routes.js" },
  { rule: "R2", file: "src/modules/a/lazy.mts", line: 1, specifier: "../b/routes.js" },
  { rule: "R3", file: "src/__tests__/file.ts", line: 1, specifier: "../modules/a/reads.js" },
  { rule: "R3", file: "src/index.ts", line: 1, specifier: "./modules/a/routes.js" },
];

function writeFixtures(rootAbs) {
  for (const [relFile, content] of FIXTURES) {
    const absFile = path.join(rootAbs, ...relFile.split("/"));
    mkdirSync(path.dirname(absFile), { recursive: true });
    writeFileSync(absFile, `${content}\n`, "utf8");
  }
}

function runSelfTest() {
  const tempBase = process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? "/tmp";
  const tempRoot = mkdtempSync(path.join(tempBase, "check-boundaries-"));
  try {
    writeFixtures(tempRoot);
    const actual = collectViolations(path.join(tempRoot, "src")).map((violation) => ({
      rule: violation.rule,
      file: toPosix(path.relative(tempRoot, violation.file)),
      line: violation.line,
      specifier: violation.specifier,
    }));
    const expected = [...EXPECTED_VIOLATIONS].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
    );
    const actualJson = JSON.stringify(actual, null, 2);
    const expectedJson = JSON.stringify(expected, null, 2);
    if (actualJson !== expectedJson) {
      console.error("SELF-TEST FAILED");
      console.error("--- expected ---");
      console.error(expectedJson);
      console.error("--- actual ---");
      console.error(actualJson);
      process.exitCode = 1;
      return;
    }
    console.log(`SELF-TEST PASSED (${actual.length} violation(s) detected as expected).`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

const isSelfTest = process.argv.includes("--self-test");
if (isSelfTest) {
  runSelfTest();
} else {
  runRealCheck();
}
