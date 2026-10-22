#!/usr/bin/env node
/**
 * Apply the npm dist-tag policy after publishing.
 *
 *   latest  → the newest stable (non-prerelease) version, or, when there
 *             is none yet, the version that was just published
 *   canary  → the version that was just published
 *
 * npm sets `latest` on the first publish of a package no matter which tag
 * was requested, and later publishes can move it around. Making the tags
 * explicit here keeps `npm i @lanefoundry/gatelane-sdk` pointing at
 * something that actually works.
 *
 * Usage:
 *   node tools/npm-dist-tags.mjs <package-name> <version> [channel]
 *
 * Exit codes:
 *   0  — tags applied
 *   1  — the tag could not be applied
 */
import { execFileSync } from "node:child_process";

const [name, version, channel = "canary"] = process.argv.slice(2);

if (!name || !version) {
  console.error("usage: npm-dist-tags.mjs <package-name> <version> [channel]");
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function npmView(args) {
  try {
    return execFileSync(npm, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Semver-ish comparison: releases sort above prereleases of the same tuple. */
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

const raw = npmView(["view", name, "versions", "--json"]);
let versions = [];
try {
  const parsed = JSON.parse(raw);
  versions = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  versions = [];
}

const parsed = versions.map((v) => ({ v, p: parse(v) })).filter((x) => x.p);
parsed.sort((a, b) => compare(a.p, b.p));

const stable = [...parsed].reverse().find((x) => x.p.prerelease === null);
const latest = stable ? stable.v : version;

console.log(`${name}: ${versions.length} version(s) on the registry`);
console.log(`  ${channel} → ${version}`);
console.log(`  latest → ${latest}${stable ? " (newest stable)" : " (no stable release yet)"}`);

function distTagAdd(spec, tag) {
  // A fresh publish is not immediately queryable, so the registry can
  // answer 404 for a short while. Retry before giving up.
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      execFileSync(npm, ["dist-tag", "add", spec, tag], { stdio: "inherit" });
      return true;
    } catch {
      if (attempt === 6) return false;
      console.log(`  ${tag} tag not applied yet (attempt ${attempt}), retrying in 15s`);
      execFileSync("sleep", ["15"], { stdio: "inherit" });
    }
  }
  return false;
}

if (!distTagAdd(`${name}@${version}`, channel)) {
  console.error(`::error::could not apply the ${channel} tag to ${name}`);
  process.exit(1);
}
if (!distTagAdd(`${name}@${latest}`, "latest")) {
  console.error(`::error::could not apply the latest tag to ${name}`);
  process.exit(1);
}
