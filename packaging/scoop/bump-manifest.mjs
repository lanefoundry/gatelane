#!/usr/bin/env node
/**
 * Bump the Scoop manifest in a sibling `scoop-bucket` repo from a
 * gatelane GitHub Release.
 *
 * Usage:
 *   node packaging/scoop/bump-manifest.mjs -- --tag=vX.Y.Z [--bucket=../scoop-bucket]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
if (!tag) {
  console.error("--tag=vX.Y.Z is required");
  process.exit(2);
}
const bucketDir = resolve(args.bucket ?? "../scoop-bucket");
const version = tag.replace(/^v/, "");

const owner = "lanefoundry";
const repo = "gatelane";
const sumsUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/SHA256SUMS`;

const sumsText = await (await fetch(sumsUrl)).text();
const checksums = parseSha256Sums(sumsText);
const windowsAmd64Zip = checksums["gatelane-windows-amd64.zip"];
if (!windowsAmd64Zip) {
  throw new Error(`SHA256SUMS missing gatelane-windows-amd64.zip entry.\nGot:\n${sumsText}`);
}

const manifestPath = `${bucketDir}/bucket/gatelane.json`;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.version = version;
manifest.architecture = {
  "64bit": {
    "url": `https://github.com/${owner}/${repo}/releases/download/${tag}/gatelane-windows-amd64.zip`,
    "hash": windowsAmd64Zip,
    "extract_dir": "gatelane-windows-amd64"
  }
};

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Updated ${manifestPath}`);
console.log(`  tag:     ${tag}`);
console.log(`  version: ${version}`);
console.log(`  sha256:  ${windowsAmd64Zip}`);

function parseSha256Sums(text) {
  const map = {};
  for (const line of text.trim().split("\n")) {
    const [sha, file] = line.split(/\s+/);
    if (sha && file) map[file] = sha;
  }
  return map;
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}