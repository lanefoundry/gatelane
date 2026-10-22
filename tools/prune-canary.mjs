#!/usr/bin/env node
/**
 * Remove old canary versions and name-reservation placeholders from the
 * registry.
 *
 * Every push to main publishes an immutable `0.0.0-canary-<sha>` version
 * to five packages, so the version list grows without bound. This keeps
 * the newest few and unpublishes the rest.
 *
 * The `0.0.0-stage` placeholders were published by hand to reserve the
 * package names before the packages existed. Now that the real packages
 * are on the registry the placeholders are dead weight: they are not on
 * any dist-tag, but they show up in the version list and in
 * `npm view <pkg> versions`.
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
const dryRun = args.includes("--dry-run") || process.env.DRY_RUN === "1";
if (dryRun) {
  const i = args.indexOf("--dry-run");
  if (i !== -1) args.splice(i, 1);
}
// Name-reservation placeholders. They are not on any dist-tag and are
// no longer needed now that the real packages exist.
const placeholders = new Set(["0.0.0-stage"]);
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
  let raw;
  try {
    raw = execFileSync(npm, ["view", spec, field, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
  if (!raw) return "";
  // `npm view <pkg> version --json` prints a quoted JSON string, so the
  // raw output is not the value.
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    return raw;
  } catch {
    return raw;
  }
}

/** Publish timestamps, keyed by version, from `npm view <pkg> time`. */
function publishTimes(name) {
  const raw = npmView(name, "time");
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    const times = new Map();
    for (const [version, value] of Object.entries(parsed)) {
      const at = Date.parse(value);
      if (Number.isFinite(at)) times.set(version, at);
    }
    return times;
  } catch {
    return new Map();
  }
}

const now = Date.now();
let removed = 0;
let failed = 0;
let blocked = false;

/**
 * npm refuses `npm unpublish` for a granular access token that bypasses
 * two-factor authentication, and trusted publishing does not expose
 * unpublish at all. So the cleanup cannot run unattended from CI with
 * the token this repository uses.
 */
function isTwoFactorBlock(message) {
  return /bypass two-factor|EOTP|one-time pass/i.test(message ?? "");
}

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

  const times = publishTimes(name);

  // The version list is ordered by semver, not by publish time — the
  // canary suffix is a commit sha, so `0.0.0-canary-3b5b5b3` sorts
  // before `0.0.0-canary-5535b4e` even though it is newer. Sort by the
  // actual publish time before deciding what to keep.
  const canaries = versions
    .filter((v) => v.includes("-canary-"))
    .sort((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0));

  const stale = [
    ...canaries.slice(keep),
    ...versions.filter((v) => placeholders.has(v)),
  ];

  if (stale.length === 0) {
    console.log(`✓ ${name}: ${canaries.length} canary version(s), nothing to prune`);
    continue;
  }

  for (const version of stale) {
    const at = times.get(version);
    if (at === undefined) {
      console.log(`  - ${name}@${version}: no publish timestamp, keeping`);
      continue;
    }
    const ageHours = (now - at) / 3_600_000;
    if (ageHours > maxAgeHours) {
      console.log(`  - ${name}@${version}: ${Math.round(ageHours)}h old, npm will not unpublish it`);
      continue;
    }
    if (blocked) {
      console.log(`  - ${name}@${version}: skipped`);
      continue;
    }
    if (dryRun) {
      console.log(`  → would unpublish ${name}@${version}`);
      removed++;
      continue;
    }
    try {
      execFileSync(npm, ["unpublish", `${name}@${version}`], { stdio: "inherit" });
    } catch (error) {
      const message = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
      if (isTwoFactorBlock(message)) {
        blocked = true;
        console.log(
          "  ! npm refused the unpublish: a token that bypasses two-factor" +
            " authentication may not perform this action.",
        );
        console.log(
          "    Cleanup from CI is not possible with this token. Run it from a" +
            " logged-in session instead: npm login && node tools/prune-canary.mjs",
        );
        break;
      }
      console.log(`  ! could not unpublish ${name}@${version}`);
      failed++;
      continue;
    }

    // npm 11 exits 0 and prints the success line even when the registry
    // answers 404, so the exit code cannot be trusted. Ask the registry
    // whether the version is really gone.
    if (npmView(`${name}@${version}`, "version") === version) {
      console.log(`  ! npm reported success but ${name}@${version} is still there`);
      failed++;
      continue;
    }
    console.log(`  ✓ unpublished ${name}@${version}`);
    removed++;
  }
}

console.log(`\nUnpublished ${removed} version(s), ${failed} problem(s).`);
if (blocked) {
  console.log(
    "Cleanup was blocked by npm's two-factor policy. The versions stay on the" +
      " registry; only the dist-tag matters for consumers.",
  );
  process.exitCode = 0;
} else if (failed > 0) {
  process.exitCode = 1;
}
