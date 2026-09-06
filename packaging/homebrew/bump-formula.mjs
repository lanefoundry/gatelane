#!/usr/bin/env node
/**
 * Bump the Homebrew formula in a sibling `homebrew-tap` repo from a
 * gatelane GitHub Release.
 *
 * Usage:
 *   pnpm release:bump-formula -- --tag=vX.Y.Z [--tap-dir=../homebrew-tap]
 *
 * The script:
 *   1. Downloads SHA256SUMS from the tagged release.
 *   2. Re-emits Formula/gatelane.rb with the new url, version, sha256, and
 *      bottle checksums.
 *   3. Stages the change in the tap repo for the operator to commit + PR.
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

const formulaPath = `${tapDir}/Formula/gatelane.rb`;
let formula = await readFile(formulaPath, "utf8");

const linuxAmd64 = checksums["gatelane-cli.tgz"]            // npm tarball (always present)
              ?? checksums["gatelane-linux-amd64.tar.gz"]; // standalone binary (preferred)
const macosArm64 = checksums["gatelane-darwin-arm64.tar.gz"];
const macosAmd64 = checksums["gatelane-darwin-amd64.tar.gz"];

if (!linuxAmd64) throw new Error(`SHA256SUMS missing linux/amd64 entry. Got:\n${sumsText}`);

formula = formula
  .replace(/url\s+"[^"]+"/, `url "https://github.com/${owner}/${repo}/releases/download/${tag}/gatelane-cli.tgz"`)
  .replace(/version\s+"[^"]+"/, `version "${version}"`)
  .replace(/PLACEHOLDER_SHA256_LINUX_AMD64/, linuxAmd64)
  .replace(/PLACEHOLDER_SHA256_DARWIN_ARM64/, macosArm64 ?? linuxAmd64)
  .replace(/PLACEHOLDER_SHA256_DARWIN_AMD64/, macosAmd64 ?? linuxAmd64);

await writeFile(formulaPath, formula);
console.log(`Updated ${formulaPath}`);
console.log(`  tag:     ${tag}`);
console.log(`  version: ${version}`);
console.log(`  sha256:  ${linuxAmd64}`);
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