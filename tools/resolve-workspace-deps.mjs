#!/usr/bin/env node
/**
 * Replace `workspace:` ranges with the concrete version of the referenced
 * workspace package.
 *
 * `pnpm publish` / `pnpm pack` do this implicitly. `npm publish` does
 * not — it publishes the manifest verbatim, so a package published with
 * npm would carry `"@lanefoundry/gatelane-sdk": "workspace:*"`, which no
 * consumer can resolve.
 *
 * Running this explicitly makes the published manifest correct no matter
 * which publisher is used, which is what lets the release workflow use
 * `npm publish` (required for npm's OIDC trusted publishing).
 *
 * ⚠️ This rewrites the manifests **in place**. Run it only in a publish
 * context (CI, after `pnpm install` and after the version has been
 * stamped) — running it in a working copy would break the workspace
 * links for `pnpm install`.
 *
 * Usage:
 *   node tools/resolve-workspace-deps.mjs [packageDir ...]
 *
 * With no arguments every package under packages/ and apps/ is rewritten.
 *
 * Exit codes:
 *   0  — manifests rewritten
 *   1  — a workspace reference could not be resolved
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function workspaceDirs() {
  const dirs = [];
  for (const group of ["packages", "apps"]) {
    const base = join(repoRoot, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(base, entry.name, "package.json");
      if (existsSync(pkgPath)) dirs.push(join(base, entry.name));
    }
  }
  return dirs;
}

const allDirs = workspaceDirs();
const byName = new Map();
for (const dir of allDirs) {
  const pkg = readJson(join(dir, "package.json"));
  byName.set(pkg.name, { version: pkg.version, dir });
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((d) => resolve(repoRoot, d))
  : allDirs;

let changed = 0;
let failed = false;

for (const dir of targets) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    console.error(`✗ ${dir}: no package.json`);
    failed = true;
    continue;
  }

  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const edits = [];

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const target = byName.get(name);
      if (!target) {
        console.error(`✗ ${pkg.name}: ${field}.${name} references an unknown workspace package`);
        failed = true;
        continue;
      }
      // workspace:* → exact version. workspace:^ / workspace:~ → the caret
      // or tilde range against the workspace version.
      const suffix = range.slice("workspace:".length);
      const resolved =
        suffix === "*"
          ? target.version
          : suffix === "^" || suffix === "~"
            ? `${suffix}${target.version}`
            : suffix;
      edits.push(`${field}.${name}: ${range} → ${resolved}`);
      deps[name] = resolved;
    }
  }

  if (edits.length === 0) continue;

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  changed++;
  console.log(`✓ ${pkg.name}`);
  for (const edit of edits) console.log(`    ${edit}`);
}

if (failed) process.exit(1);
console.log(`\nRewrote ${changed} manifest(s).`);
