#!/usr/bin/env node
/**
 * Remove old canary versions from the registry.
 *
 * Every push to main publishes an immutable `0.0.0-canary-<sha>` version
 * to five packages, so the version list grows without bound. This keeps
 * the newest few and unpublishes the rest.
 *
 * npm only allows unpublishing a version that was published less than
 * 72 hours ago, so this is a best-effort cleanup of recent versions.
 * Anything older stays — that is a registry policy, not something a
 * client can work around.
 *
 * Requires a token with write access. OIDC cannot be used: npm does not
 * expose `npm unpublish` over trusted publishing.
 *
 * Usage:
 *   node tools/prune-canary.mjs [--keep 5] [--max-age-hours 72] [package ...]
 *
 * Exit codes:
 *   0  — cleanup ran (individual unpublish failures are reported, not fatal)
 *   1  — the registry could not be queried
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(args[i + 1]);
  args.splice(i, 2);
  return Number.isFinite(value) ? value : fallback;
}

const keep = flag("keep", 5);
const maxAgeHours = flag("max-age-hours", 72);
const packages = args.length
  ? args
  : [
      "@lanefoundry/gatelane-sdk",
      "@lanefoundry/gatelane-engine",
      "@lanefoundry/source-prod-slice",
      "@lanefoundry/gatelane-cli",
      "@lanefoundry/gatelane-ci-adapter",
    ];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function npmView(spec, field) {
  try {
    return execFileSync(npm, ["view", spec, field, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Milliseconds since the epoch, or null when npm has no timestamp. */
function publishedAt(spec) {
  const raw = npmView(spec, "time");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const value = parsed[spec];
    return value ? Date.parse(value) : null;
  } catch {
    return null;
  }
}

const now = Date.now();
let removed = 0;
let failed = 0;

for (const name of packages) {
  const raw = npmView(name, "versions");
  if (!raw) {
    console.error(`✗ ${name}: could not read the versions from the registry`);
    failed++;
    continue;
  }

  let versions;
  try {
    const parsed = JSON.parse(raw);
    versions = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error(`✗ ${name}: unexpected registry response`);
    failed++;
    continue;
  }

  const canaries = versions.filter((v) => v.includes("-canary-"));
  if (canaries.length <= keep) {
    console.log(`✓ ${name}: ${canaries.length} canary version(s), nothing to prune`);
    continue;
  }

  // Newest first, so the tail is what we remove.
  const ordered = [...canaries].reverse();
  const stale = ordered.slice(keep);

  for (const version of stale) {
    const at = publishedAt(`${name}@${version}`);
    if (at === null) {
      console.log(`  - ${name}@${version}: no publish timestamp, keeping`);
      continue;
    }
    const ageHours = (now - at) / 3_600_000;
    if (ageHours > maxAgeHours) {
      console.log(`  - ${name}@${version}: ${Math.round(ageHours)}h old, npm will not unpublish it`);
      continue;
    }
    try {
      execFileSync(npm, ["unpublish", `${name}@${version}`], { stdio: "inherit" });
      console.log(`  ✓ unpublished ${name}@${version}`);
      removed++;
    } catch {
      console.log(`  ! could not unpublish ${name}@${version}`);
      failed++;
    }
  }
}

console.log(`\nUnpublished ${removed} version(s), ${failed} problem(s).`);
if (failed > 0) process.exitCode = 1;
