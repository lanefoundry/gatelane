#!/usr/bin/env node
/**
 * Bump the Homebrew formula in a sibling `homebrew-tap` repo from a
 * gatelane GitHub Release.
 *
 * Usage:
 *   node packaging/homebrew/bump-formula.mjs -- --tag=vX.Y.Z [--tap-dir=../homebrew-tap]
 *
 * The script:
 *   1. Downloads SHA256SUMS from the tagged release.
 *   2. Re-emits Formula/gatelane.rb with the new url, version and the
 *      sha256 of every platform archive.
 *   3. Stages the change in the tap repo for the operator to commit + PR.
 *
 * The url and the sha256 must come from the same asset, otherwise
 * Homebrew rejects the download. The earlier version of this script
 * took the sha256 of `gatelane-linux-amd64.tar.gz` but hardcoded a url
 * of `gatelane-cli.tgz`, which is not an asset of the release.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
if (!tag) {
  console.error("--tag=vX.Y.Z is required");
  process.exit(2);
}
const tapDir = resolve(args["tap-dir"] ?? "../homebrew-tap");
const version = tag.replace(/^v/, "");

const owner = "lanefoundry";
const repo = "gatelane";
const sumsUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/SHA256SUMS`;

const sumsText = await (await fetch(sumsUrl)).text();
const checksums = parseSha256Sums(sumsText);

/** asset name → { url, placeholder } */
const targets = {
  "gatelane-darwin-arm64.tar.gz": "PLACEHOLDER_SHA256_DARWIN_ARM64",
  "gatelane-darwin-amd64.tar.gz": "PLACEHOLDER_SHA256_DARWIN_AMD64",
  "gatelane-linux-arm64.tar.gz": "PLACEHOLDER_SHA256_LINUX_ARM64",
  "gatelane-linux-amd64.tar.gz": "PLACEHOLDER_SHA256_LINUX_AMD64",
};

for (const asset of Object.keys(targets)) {
  if (!checksums[asset]) {
    throw new Error(`SHA256SUMS is missing ${asset}.\nGot:\n${sumsText}`);
  }
}

const formulaPath = `${tapDir}/Formula/gatelane.rb`;
let formula = await readFile(formulaPath, "utf8");

// Each platform block carries its own url and sha256. Rewrite them
// line by line so the url and the checksum always refer to the same
// asset, and so the surrounding Ruby syntax is left alone.
const lines = formula.split("\n");
for (const [asset, placeholder] of Object.entries(targets)) {
  const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset}`;

  const urlIndex = lines.findIndex((line) => line.includes("url ") && line.includes(asset));
  if (urlIndex === -1) {
    throw new Error(`could not find the url line for ${asset} in ${formulaPath}`);
  }
  lines[urlIndex] = lines[urlIndex].replace(/(url\s+")[^"]*(")/, `$1${url}$2`);

  const shaIndex = lines.findIndex((line) => line.includes(placeholder));
  if (shaIndex === -1) {
    throw new Error(`could not find ${placeholder} in ${formulaPath}`);
  }
  lines[shaIndex] = lines[shaIndex].replace(/(sha256\s+")[^"]*(")/, `$1${checksums[asset]}$2`);
}
formula = lines.join("\n");

formula = formula.replace(/version\s+"[^"]+"/, `version "${version}"`);

await writeFile(formulaPath, formula);
console.log(`Updated ${formulaPath}`);
console.log(`  tag:     ${tag}`);
console.log(`  version: ${version}`);
for (const [asset, placeholder] of Object.entries(targets)) {
  console.log(`  ${asset}: ${checksums[asset]} (${placeholder})`);
}
console.log("");
console.log("Next: cd into the tap repo, commit, and open a PR.");

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
