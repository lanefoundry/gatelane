#!/usr/bin/env node
/**
 * Bump the winget manifest in `microsoft/winget-pkgs` from a gatelane
 * GitHub Release. winget-pkgs is a giant read-only history; we
 * materialise the new version files into a fork's working branch.
 *
 * Usage:
 *   node packaging/winget/bump-manifest.mjs -- --tag=vX.Y.Z [--pkg-dir=../winget-pkgs]
 */
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
if (!tag) {
  console.error("--tag=vX.Y.Z is required");
  process.exit(2);
}
const pkgDir = resolve(args["pkg-dir"] ?? "../winget-pkgs");
const version = tag.replace(/^v/, "");

const owner = "lanefoundry";
const repo = "gatelane";
const sumsUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/SHA256SUMS`;

const sumsText = await (await fetch(sumsUrl)).text();
const checksums = parseSha256Sums(sumsText);
const winAmd64Zip = checksums["gatelane-windows-amd64.zip"];
if (!winAmd64Zip) {
  throw new Error(`SHA256SUMS missing gatelane-windows-amd64.zip entry.\nGot:\n${sumsText}`);
}

const targetDir = `${pkgDir}/manifests/l/${owner}/gatelane/${version}`;
await mkdir(targetDir, { recursive: true });

const templateDir = resolve(import.meta.dirname, "manifests/l/lanefoundry/gatelane/X.Y.Z");
for (const file of [
  "lanefoundry.gatelane.yaml",
  "lanefoundry.gatelane.installer.yaml",
  "lanefoundry.gatelane.locale.en-US.yaml",
]) {
  let body = await readFile(`${templateDir}/${file}`, "utf8");
  body = body
    .replaceAll("X.Y.Z", version)
    .replace("PLACEHOLDER_SHA256_WINDOWS_AMD64", winAmd64Zip);
  await writeFile(`${targetDir}/${file}`, body);
}

console.log(`Materialised ${targetDir}`);
console.log(`  tag:    ${tag}`);
console.log(`  sha256: ${winAmd64Zip}`);
console.log("");
console.log("Next:");
console.log(`  cd ${pkgDir}`);
console.log(`  git checkout -b ${owner}/gatelane-${version}`);
console.log(`  git add manifests/l/${owner}/gatelane/${version}`);
console.log(`  git commit -m "Add ${owner}.gatelane ${version}"`);
console.log(`  gh pr create --repo microsoft/winget-pkgs --title "Add ${owner}.gatelane ${version}"`);

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