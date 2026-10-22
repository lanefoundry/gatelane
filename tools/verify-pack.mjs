#!/usr/bin/env node
/**
 * Smoke-test the packed tarballs the way a real consumer would use them.
 *
 * Catches the failure modes that a `tsc` build alone does not:
 *   - a package shipped without dist/ (empty tarball)
 *   - a tarball still carrying an unresolvable `workspace:*` dependency
 *   - a missing transitive package in the install set
 *   - a broken bin entry
 *
 * Usage:
 *   node tools/verify-pack.mjs [tarballDir]
 *
 * Exit codes:
 *   0  — clean install, SDK imports, CLI runs
 *   1  — consumer install would fail
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const tarballDir = resolve(repoRoot, process.argv[2] ?? "artifacts/npm");
const tarballs = readdirSync(tarballDir)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => join(tarballDir, f));

if (tarballs.length === 0) {
  console.error(`No .tgz files in ${tarballDir} — run \`pnpm pack:all\` first.`);
  process.exit(1);
}

const project = mkdtempSync(join(tmpdir(), "gatelane-verify-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

try {
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "gatelane-pack-verify", private: true, type: "module" }, null, 2),
  );

  console.log(`Installing ${tarballs.length} tarballs into ${project}`);
  run(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", ...tarballs], {
    cwd: project,
    stdio: ["ignore", "inherit", "inherit"],
  });

  const sdkEntry = pathToFileURL(join(project, "node_modules/@lanefoundry/gatelane-sdk/dist/index.js")).href;
  const captureEntry = pathToFileURL(
    join(project, "node_modules/@lanefoundry/gatelane-sdk/dist/capture.js"),
  ).href;

  const sdk = await import(sdkEntry);
  const capture = await import(captureEntry);

  if (typeof sdk.FilesystemStorage !== "function") {
    throw new Error("gatelane-sdk: FilesystemStorage export is missing");
  }
  if (typeof capture.capture !== "function" || typeof capture.withCapture !== "function") {
    throw new Error("gatelane-sdk/capture: capture / withCapture exports are missing");
  }
  console.log(`✓ sdk imports (${Object.keys(sdk).length} exports)`);

  const cliBin = join(project, "node_modules/.bin/gatelane");
  const help = run(cliBin, ["--help"], { cwd: project });
  if (!help.includes("promotion gate")) {
    throw new Error("gatelane CLI did not print its usage text");
  }
  console.log("✓ gatelane CLI runs");

  console.log("\nPack is installable by a clean project.");
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(project, { recursive: true, force: true });
}
