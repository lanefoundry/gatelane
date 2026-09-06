#!/usr/bin/env node
/**
 * SDK parity drift check.
 *
 * Reads docs/sdk-parity.md, parses the per-language status columns,
 * greps each SDK source for the expected public symbol, and exits
 * non-zero if a symbol marked "shipped" / "scaffolded" is missing.
 *
 * Usage:
 *   node tools/check-sdk-parity.mjs
 *
 * Exit codes:
 *   0  — clean (or only warnings about planned symbols that ship)
 *   1  — drift: a shipped/scaffolded symbol is missing in source
 *   2  — usage error
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const parityDocPath = resolve(repoRoot, "docs/sdk-parity.md");
// JS SDK family = published SDK + engine (engine primitives are part of the
// JS surface; Python SDK intentionally does not embed the engine in v1).
const jsRoots = [
  resolve(repoRoot, "packages/gatelane-sdk/src"),
  resolve(repoRoot, "packages/gatelane-engine/src"),
];
const pySdkRoot = resolve(repoRoot, "packages/gatelane-sdk-py/src/gatelane_sdk");

// ---------------------------------------------------------------------------
// 1. Read parity doc
// ---------------------------------------------------------------------------
const text = await readFile(parityDocPath, "utf8");

/** @typedef {{ name: string, js: string, py: string, wire?: string }} Row */
/** @type {Row[]} */
const rows = parseParityTable(text);

if (rows.length === 0) {
  console.error("ERROR: no rows parsed from docs/sdk-parity.md");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. Collect source files
// ---------------------------------------------------------------------------
const jsSources = (await Promise.all(jsRoots.map(collectSources))).flat();
const pySources = await collectSources(pySdkRoot);

if (jsSources.length === 0) {
  console.error("ERROR: no JS sources found under packages/gatelane-sdk/src or packages/gatelane-engine/src");
  process.exit(2);
}
if (pySources.length === 0) {
  console.error(`ERROR: no Python sources found under ${pySdkRoot}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 3. Read all source bodies once
// ---------------------------------------------------------------------------
const jsBodies = await Promise.all(jsSources.map((f) => readFile(f, "utf8")));
const pyBodies = await Promise.all(pySources.map((f) => readFile(f, "utf8")));

// ---------------------------------------------------------------------------
// 4. For each "shipped" / "scaffolded" symbol, check both sides
// ---------------------------------------------------------------------------
let driftCount = 0;
let warningCount = 0;
const isShipped = (status) => status === "✓" || status === "◯";
const isPlanned = (status) => status === "·";

for (const row of rows) {
  const ids = extractIdentifiers(row.name);
  // Descriptive rows (retries, headers, failure propagation) aren't code
  // symbols — they can't be grepped. Skip them in the machine check.
  if (ids.length === 0) continue;

  for (const id of ids) {
    if (isShipped(row.js) && !existsInSource(id, jsBodies)) {
      console.error(`DRIFT (JS): "${id}" marked ${row.js} but not found in JS SDK`);
      driftCount++;
    }
    if (isShipped(row.py) && !existsInSource(id, pyBodies)) {
      console.error(`DRIFT (PY): "${id}" marked ${row.py} but not found in Python SDK`);
      driftCount++;
    }
    if (isPlanned(row.js) && existsInSource(id, jsBodies)) {
      console.warn(`WARN: planned JS symbol "${id}" exists in source — update parity doc`);
      warningCount++;
    }
    if (isPlanned(row.py) && existsInSource(id, pyBodies)) {
      console.warn(`WARN: planned PY symbol "${id}" exists in source — update parity doc`);
      warningCount++;
    }
  }
}

if (driftCount > 0) {
  console.error("");
  console.error(`FAILED: ${driftCount} drift issue(s) found.`);
  process.exit(1);
}

console.log(`OK: ${rows.length} parity rows checked, ${warningCount} warning(s).`);
process.exit(0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse markdown tables in docs/sdk-parity.md. Each row looks like:
 *   | Symbol | JS SDK | Python SDK | Wire format |
 *   |---|---|---|---|
 *   | capture() | ✓ | ✓ | POST /v1/capture |
 *
 * Skips header rows, separator rows, and section title rows
 * (cells starting with "Surface", "JS SDK", "Status", "Wire").
 */
function parseParityTable(markdown) {
  const lines = markdown.split("\n");
  /** @type {Row[]} */
  const out = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 3) continue;

    const [name, js, py, wire] = cells;
    if (!name) continue;

    // Skip column header rows
    if (/^(Surface|Status|Name|Symbol|JS|Python)/i.test(name)) continue;

    out.push({ name, js, py, wire });
  }
  return out;
}

async function collectSources(root) {
  /** @type {string[]} */
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (/\.(ts|js|py)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files;
}

/**
 * Extract machine-checkable identifiers from a parity row name.
 *
 * Handles:
 *   - `capture()`                     → ["capture"]
 *   - `withCapture()` / `with_capture()` → ["withCapture", "with_capture"]
 *   - `HttpStorage` (HTTP transport)  → ["HttpStorage"]
 *   - "Capture write retries (…)"     → []  (descriptive; not a symbol)
 */
function extractIdentifiers(name) {
  return name
    .replace(/`/g, "")
    .split("/")
    .map((part) => part.replace(/[()]/g, "").trim())
    .filter((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
}

/**
 * Does the given identifier exist in any of the source bodies?
 */
function existsInSource(cleanName, bodies) {
  const isClass = /^[A-Z]/.test(cleanName);
  const altNames = [cleanName, snakeToCamel(cleanName), camelToSnake(cleanName)];

  /** @type {RegExp[]} */
  const patterns = [];

  if (isClass) {
    for (const n of altNames) {
      patterns.push(new RegExp(`\\bclass\\s+${escape(n)}\\b`));
      patterns.push(new RegExp(`\\bexport\\s+class\\s+${escape(n)}\\b`));
    }
  } else {
    for (const n of altNames) {
      patterns.push(new RegExp(`\\bfunction\\s+${escape(n)}\\b`));
      patterns.push(new RegExp(`\\bexport\\s+function\\s+${escape(n)}\\b`));
      patterns.push(new RegExp(`\\bdef\\s+${escape(n)}\\b`));
      patterns.push(new RegExp(`\\basync\\s+def\\s+${escape(n)}\\b`));
    }
  }

  // Fall back to bare symbol match (covers const exports, decorators, etc.)
  for (const n of altNames) {
    patterns.push(new RegExp(`\\b${escape(n)}\\b`));
  }

  return bodies.some((body) => patterns.some((p) => p.test(body)));
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}