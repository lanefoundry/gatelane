#!/usr/bin/env node
/**
 * Pack every publishable workspace package into a single directory.
 *
 * `pnpm pack` rewrites `workspace:*` dependencies to the concrete version
 * from package.json, which is exactly what a consumer installs from the
 * registry. That makes the tarballs a working offline substitute for the
 * unpublished packages:
 *
 *   npm i ./artifacts/npm/*.tgz
 *
 * Usage:
 *   node tools/pack-all.mjs [outDir]
 *
 * Exit codes:
 *   0  — tarballs written
 *   1  — a package could not be packed (usually: dist/ was never built)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const outDir = resolve(repoRoot, process.argv[2] ?? "artifacts/npm");

// Dependency order: consumers resolving these tarballs together need every
// transitive @lanefoundry package present in the install command.
const packages = [
  "packages/gatelane-sdk",
  "packages/gatelane-engine",
  "packages/source-prod-slice",
  "packages/cli",
  "packages/ci-adapter",
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let failed = false;
const packed = [];

for (const pkg of packages) {
  const dir = resolve(repoRoot, pkg);
  const dist = resolve(dir, "dist");
  const pkgJson = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));

  if (!existsSync(dist)) {
    console.error(`✗ ${pkgJson.name}: dist/ is missing — run \`pnpm -r --filter "./packages/*" build\` first`);
    failed = true;
    continue;
  }

  try {
    const before = new Set(readdirSync(outDir));
    execFileSync("pnpm", ["pack", "--pack-destination", outDir], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const tarball = readdirSync(outDir).find((f) => !before.has(f) && f.endsWith(".tgz"));
    if (!tarball) throw new Error("no tarball produced");
    packed.push(join(outDir, tarball));
    console.log(`✓ ${pkgJson.name}@${pkgJson.version}`);
  } catch (error) {
    console.error(`✗ ${pkgJson.name}: ${error.message ?? "pnpm pack failed"}`);
    failed = true;
  }
}

if (failed || packed.length !== packages.length) {
  console.error(`\nPacked ${packed.length}/${packages.length} packages into ${outDir}`);
  process.exit(1);
}

console.log(`\nPacked ${packed.length} packages into ${outDir}`);
console.log("\nInstall them in another project with:");
console.log(`  npm i ${outDir}/*.tgz`);
console.log(`  # or: pnpm add ${packed.join(" ")}`);
